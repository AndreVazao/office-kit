import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { SqliteOfficeIncidentStore } from "../src/sqlite-office-incident-store.mjs";

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const sqliteTest = DatabaseSync ? test : test.skip;

function adapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec(`BEGIN ${mode}`);
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

function provider(key, keyId = "test-cng-journal-v1") {
  return {
    keyId,
    hmacSha256Hex: value => createHmac("sha256", key).update(value, "utf8").digest("hex")
  };
}

function cryptoProvider() {
  return {
    sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"),
    randomUUID
  };
}

function incident(id = "incident-mac-001") {
  return {
    id,
    occurredAt: "2026-11-11T12:00:00.000Z",
    status: "degraded",
    origin: "transport",
    evidence: { code: "connection_lost", detail: "read-only probe failed" }
  };
}

sqliteTest("requires the protected MAC key before incident reads and writes", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-required-001",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    assert.throws(() => store.verifyIntegrity(), /incident_integrity_key_unavailable/);
    await assert.rejects(store.append(incident()), /incident_integrity_key_unavailable/);
    const result = store.configureMacProvider(provider(Buffer.alloc(32, 7)));
    assert.equal(result.status, "keyed_hmac_chain");
    await store.append(incident());
    assert.equal(store.verifyIntegrity().verification, "sha256_plus_keystore_hmac");
  } finally {
    database.close();
  }
});

sqliteTest("authenticates each immutable event and detects a modified MAC", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-tamper-001",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    store.configureMacProvider(provider(Buffer.alloc(32, 11)));
    await store.append(incident());
    await store.update("incident-mac-001", { outcome: "recovered" });
    assert.equal(store.verifyIntegrity().eventCount, 2);
    assert.throws(() => database.prepare(
      "UPDATE office_kit_incident_event_macs SET event_mac = ? WHERE installation_id = ? AND sequence = 2"
    ).run("0".repeat(64), "officekit-mac-tamper-001"), /incident_event_mac_immutable/);
    database.exec("DROP TRIGGER office_kit_incident_event_macs_immutable_update");
    database.prepare(
      "UPDATE office_kit_incident_event_macs SET event_mac = ? WHERE installation_id = ? AND sequence = 2"
    ).run("0".repeat(64), "officekit-mac-tamper-001");
    assert.throws(() => store.verifyIntegrity(), /incident_mac_chain_corrupt/);
    await assert.rejects(store.list(), /incident_mac_chain_corrupt/);
  } finally {
    database.close();
  }
});

sqliteTest("rejects a journal reopened with a different CNG-protected key", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const first = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-key-change-001",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    first.configureMacProvider(provider(Buffer.alloc(32, 3)));
    await first.append(incident());
    const reopened = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-key-change-001",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    assert.throws(
      () => reopened.configureMacProvider(provider(Buffer.alloc(32, 4))),
      /incident_mac_chain_corrupt/
    );
  } finally {
    database.close();
  }
});

sqliteTest("upgrades a verified legacy SHA-256 journal to a keyed MAC chain", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const legacy = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-upgrade-001",
      cryptoProvider: cryptoProvider()
    });
    await legacy.append(incident());
    await legacy.update("incident-mac-001", { outcome: "recovered" });
    assert.equal(legacy.verifyIntegrity().status, "unkeyed_hash_chain");

    const upgraded = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-upgrade-001",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    const result = upgraded.configureMacProvider(provider(Buffer.alloc(32, 19)));
    assert.equal(result.status, "keyed_hmac_chain");
    assert.equal(result.eventCount, 2);
    assert.equal(upgraded.listEvents().length, 2);
  } finally {
    database.close();
  }
});

sqliteTest("detects missing, extra and cross-installation MAC records", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const key = Buffer.alloc(32, 23);
    const first = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-scope-001",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    first.configureMacProvider(provider(key));
    await first.append(incident());
    assert.equal(first.verifyIntegrity().eventCount, 1);

    const other = new SqliteOfficeIncidentStore({
      database: adapter(database),
      installationId: "officekit-mac-scope-002",
      cryptoProvider: cryptoProvider(),
      requireMac: true
    });
    other.configureMacProvider(provider(key));
    assert.equal(other.verifyIntegrity().eventCount, 0);

    database.exec("DROP TRIGGER office_kit_incident_event_macs_immutable_delete");
    database.prepare(
      "DELETE FROM office_kit_incident_event_macs WHERE installation_id = ? AND sequence = 1"
    ).run("officekit-mac-scope-001");
    assert.throws(() => first.verifyIntegrity(), /incident_mac_chain_incomplete/);
  } finally {
    database.close();
  }
});
