import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
import { WindowsCngSecretVault } from "../../windows-host/src/secret-vault.mjs";
import { createWindowsVstHost } from "../src/vst-windows-host.mjs";

const hostExecutable = process.env.OFFICE_KIT_CNG_HOST_PATH;
const skipReason = process.platform !== "win32"
  ? "VST CNG integration requires a Windows runner."
  : !hostExecutable
    ? "OFFICE_KIT_CNG_HOST_PATH must point to the published native helper."
    : !DatabaseSync
      ? "node:sqlite is unavailable in this Node runtime."
      : false;

const fixedNow = Date.parse("2026-11-12T12:00:00.000Z");
const ownerToken = "vst-owner-token-" + "0123456789".repeat(4);

function sqliteAdapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec("BEGIN " + mode);
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    };
    const wrapped = () => run("");
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  };
  return { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };
}

function makeHostFactory(filename, installationId, capture) {
  return () => {
    const database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    capture.database = database;
    let closed = false;
    return {
      installationId,
      ready: Promise.resolve({ status: "empty" }),
      createSecretStore(namespace) {
        const vault = new WindowsCngSecretVault({
          database: sqliteAdapter(database),
          installationId,
          namespace,
          hostExecutable
        });
        capture.vaults ??= new Map();
        capture.vaults.set(namespace, vault);
        return vault;
      },
      async health() { return { status: "ready", identityStatus: "empty" }; },
      async close() {
        if (closed) return;
        closed = true;
        database.close();
      }
    };
  };
}

function observerResponse() {
  return {
    ok: true,
    status: "OFF",
    mode: "PAPER",
    open_positions_count: 0,
    opportunities_count: 0,
    updated_at_ms: fixedNow,
    health_state: "unknown",
    allow_new_tasks: false,
    allow_risk_bearing_actions: false,
    health_checked_at_ms: 0
  };
}

function response(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => data
  };
}

test("VST Windows composition persists its owner token through the real CNG vault", {
  skip: skipReason,
  timeout: 45_000
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-vst-cng-"));
  const filename = join(directory, "office-kit.sqlite");
  const installationId = "officekit-ci-" + randomUUID().replaceAll("-", "");
  const requests = [];
  let firstCapture = {};
  let secondCapture = {};
  let firstHost;
  let secondHost;
  let tokenRemoved = false;

  const adapterOptions = {
    now: () => fixedNow,
    timeoutMs: 5_000,
    pollIntervalMs: 60_000,
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        method: init.method,
        token: init.headers?.["X-Token"] ?? null,
        authorization: init.headers?.Authorization ?? null
      });
      return response(observerResponse());
    }
  };

  try {
    firstHost = createWindowsVstHost({
      hostFactory: makeHostFactory(filename, installationId, firstCapture),
      adapterOptions
    });
    await firstHost.ready;
    const provisioned = await firstHost.provisionLocalApiToken({
      token: ownerToken,
      ownerConsent: true
    });
    assert.equal(provisioned.stored, true);
    assert.equal(provisioned.namespace, "vst.local-api");
    assert.equal(provisioned.hardwareBacked, false);
    assert.equal(firstHost.getCredentialState().configured, true);
    const nativeVault = firstCapture.vaults.get("vst.local-api");
    assert.equal(nativeVault.getCapabilities().privateKeyNonExportable, true);
    assert.equal(nativeVault.getCapabilities().hardwareBacked, false);
    assert.equal(await nativeVault.checkNonExportable(), true);
    assert.equal(requests.length, 0, "credential provisioning must not auto-connect");

    const row = firstCapture.database.prepare(
      "SELECT envelope_json FROM office_kit_protected_secrets WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ).get(installationId, "vst.local-api", "owner-token");
    assert.ok(row);
    assert.doesNotMatch(row.envelope_json, new RegExp(ownerToken));

    await firstHost.close();
    firstHost = null;

    secondHost = createWindowsVstHost({
      hostFactory: makeHostFactory(filename, installationId, secondCapture),
      adapterOptions
    });
    await secondHost.ready;
    assert.equal(secondHost.getCredentialState().configured, true);

    const connected = await secondHost.connect();
    assert.equal(connected.connected, true);
    assert.equal(requests[0].url, "http://127.0.0.1:8765/observer/summary");
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].token, ownerToken);
    assert.equal(requests[0].authorization, null);

    const snapshot = await secondHost.getSnapshot();
    assert.equal(snapshot.backend.engineStatus, "OFF");
    assert.equal(snapshot.backend.mode, "PAPER");
    assert.equal(snapshot.backend.executionAuthorized, false);
    assert.equal(snapshot.backend.allowRiskBearingActions, false);
    assert.equal(snapshot.backend.runtimeReadiness, "unverified");

    const removed = await secondHost.removeLocalApiToken({ ownerConsent: true });
    assert.equal(removed.deletedCount, 1);
    assert.equal(removed.keyDeleted, true);
    assert.equal(secondHost.getCredentialState().configured, false);
    tokenRemoved = true;
  } finally {
    if (firstHost) {
      try { await firstHost.close(); } catch {}
    }
    if (secondHost) {
      if (!tokenRemoved) {
        try { await secondHost.removeLocalApiToken({ ownerConsent: true }); } catch {}
      }
      try { await secondHost.close(); } catch {}
    }
    try { firstCapture.database?.close(); } catch {}
    try { secondCapture.database?.close(); } catch {}
    if (!tokenRemoved && DatabaseSync) {
      try {
        const cleanupDatabase = new DatabaseSync(filename);
        try {
          const cleanupVault = new WindowsCngSecretVault({
            database: sqliteAdapter(cleanupDatabase),
            installationId,
            namespace: "vst.local-api",
            hostExecutable
          });
          await cleanupVault.destroy();
        } finally {
          cleanupDatabase.close();
        }
      } catch {}
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
