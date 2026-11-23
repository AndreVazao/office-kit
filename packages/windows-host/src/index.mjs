import { constants, createHash, createHmac, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  lstatSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createWindowsNodeIdentityRuntime } from "../../scene-engine/src/windows.mjs";
import { detectHostHardwareCapabilities } from "./hardware-capabilities.mjs";
import { SqliteInstallationLifecycleStore } from "./sqlite-installation-lifecycle-store.mjs";
import { createInstallationLifecycle as createInstallationLifecycleController } from "./installation-lifecycle.mjs";
import { resolveAdaptiveResourcePolicy } from "../../scene-engine/src/resource-policy.mjs";
import { SqliteOfficeIncidentStore } from "../../scene-engine/src/sqlite-office-incident-store.mjs";
import { AdapterGateway } from "../../scene-engine/src/adapter-gateway.mjs";
import { OfficeConnectionSupervisor, OfficeHealthRecoveryEngine } from "../../scene-engine/src/office-health.mjs";
import { WindowsCngSecretVault } from "./secret-vault.mjs";
import { acquireWindowsHostProcessLock } from "./process-lock.mjs";
import { createInProcessExclusiveLockProvider } from "../../scene-engine/src/exclusive-operation-lock.mjs";
import { SqliteMonotonicCheckpointJournal } from "../../scene-engine/src/sqlite-monotonic-checkpoint-journal.mjs";
import { SqliteMonotonicCheckpointCoordinator } from "../../scene-engine/src/sqlite-monotonic-checkpoint.mjs";
import { MonotonicIncidentWriter } from "../../scene-engine/src/monotonic-incident-writer.mjs";

const INSTALLATION_ID_PATTERN = /^officekit-[a-f0-9]{32}$/;

const PUBLISHER_POLICY_FORMAT = "officekit-publisher-policy-envelope-v1";
const PUBLISHER_POLICY_EDITION_SET = new Set(["universal", "dgmat", "vst"]);
const PUBLISHER_POLICY_INSTALL_REVOCATION = "online-chain-exclude-root-fail-closed";
const PUBLISHER_POLICY_RUNTIME_REVOCATION = "cache-only-chain-exclude-root-fail-closed";
const PUBLISHER_POLICY_PAYLOAD_KEYS = [
  "schemaVersion",
  "productId",
  "edition",
  "installationId",
  "keyName",
  "policyVersion",
  "createdAt",
  "publisherSpkiSha256",
  "signatureIndex",
  "revocationPolicy"
];
const PUBLISHER_POLICY_ENVELOPE_KEYS = ["format", "keyName", "payload", "signature"];

function publisherPolicyKeyName(installationId) {
  if (typeof installationId !== "string" || !INSTALLATION_ID_PATTERN.test(installationId)) {
    throw new TypeError("publisher_policy_installation_id_invalid");
  }
  return \`okp-\${createHash("sha256").update(installationId, "utf8").digest("hex").slice(0, 32)}\`;
}

function assertExactKeys(value, expectedKeys, errorCode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(errorCode);
  }
  const actual = Object.keys(value);
  if (actual.length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(errorCode);
  }
}

function toPolicyBytes(value, errorCode, maxBytes) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array) && typeof value !== "string") {
    throw new TypeError(errorCode);
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes.length < 1 || bytes.length > maxBytes) throw new RangeError(errorCode);
  return bytes;
}

function decodeCanonicalBase64(value, errorCode, maxBytes) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maxBytes * 4 / 3) + 8) {
    throw new TypeError(errorCode);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(errorCode);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > maxBytes || bytes.toString("base64") !== value) {
    throw new TypeError(errorCode);
  }
  return bytes;
}

function validatePublisherPolicyFields(policy) {
  assertExactKeys(policy, PUBLISHER_POLICY_PAYLOAD_KEYS, "publisher_policy_payload_schema_invalid");
  if (policy.schemaVersion !== 1 || policy.productId !== "office-kit") {
    throw new TypeError("publisher_policy_payload_version_invalid");
  }
  if (!PUBLISHER_POLICY_EDITION_SET.has(policy.edition)) {
    throw new TypeError("publisher_policy_edition_invalid");
  }
  if (typeof policy.installationId !== "string" || !INSTALLATION_ID_PATTERN.test(policy.installationId)) {
    throw new TypeError("publisher_policy_installation_id_invalid");
  }
  if (policy.keyName !== publisherPolicyKeyName(policy.installationId)) {
    throw new TypeError("publisher_policy_key_name_invalid");
  }
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1) {
    throw new TypeError("publisher_policy_version_invalid");
  }
  if (typeof policy.createdAt !== "string") {
    throw new TypeError("publisher_policy_created_at_invalid");
  }
  const createdAt = new Date(policy.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== policy.createdAt) {
    throw new TypeError("publisher_policy_created_at_invalid");
  }
  if (typeof policy.publisherSpkiSha256 !== "string" || !/^[0-9a-f]{64}$/.test(policy.publisherSpkiSha256)) {
    throw new TypeError("publisher_policy_publisher_spki_invalid");
  }
  if (policy.signatureIndex !== 0) {
    throw new TypeError("publisher_policy_signature_index_unsupported");
  }
  assertExactKeys(policy.revocationPolicy, ["installUpdate", "runtimeStartup"], "publisher_policy_revocation_schema_invalid");
  if (policy.revocationPolicy.installUpdate !== PUBLISHER_POLICY_INSTALL_REVOCATION
      || policy.revocationPolicy.runtimeStartup !== PUBLISHER_POLICY_RUNTIME_REVOCATION) {
    throw new TypeError("publisher_policy_revocation_policy_invalid");
  }
  return policy;
}

function parseCanonicalPublisherPolicyPayload(payloadBytes) {
  const bytes = toPolicyBytes(payloadBytes, "publisher_policy_payload_size_invalid", 65536);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new TypeError("publisher_policy_payload_encoding_invalid");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("publisher_policy_payload_json_invalid");
  }
  validatePublisherPolicyFields(parsed);

  const canonical = {
    schemaVersion: parsed.schemaVersion,
    productId: parsed.productId,
    edition: parsed.edition,
    installationId: parsed.installationId,
    keyName: parsed.keyName,
    policyVersion: parsed.policyVersion,
    createdAt: parsed.createdAt,
    publisherSpkiSha256: parsed.publisherSpkiSha256,
    signatureIndex: parsed.signatureIndex,
    revocationPolicy: {
      installUpdate: parsed.revocationPolicy.installUpdate,
      runtimeStartup: parsed.revocationPolicy.runtimeStartup
    }
  };
  if (JSON.stringify(canonical) !== text) throw new TypeError("publisher_policy_payload_noncanonical");
  return Object.freeze({
    ...canonical,
    revocationPolicy: Object.freeze(canonical.revocationPolicy)
  });
}

export function createPublisherPolicyPayload(input) {
  assertExactKeys(input, ["edition", "installationId", "policyVersion", "createdAt", "publisherSpkiSha256"],
    "publisher_policy_input_schema_invalid");
  const installationId = input.installationId;
  const policy = {
    schemaVersion: 1,
    productId: "office-kit",
    edition: input.edition,
    installationId,
    keyName: publisherPolicyKeyName(installationId),
    policyVersion: input.policyVersion,
    createdAt: input.createdAt,
    publisherSpkiSha256: typeof input.publisherSpkiSha256 === "string"
      ? input.publisherSpkiSha256.toLowerCase()
      : input.publisherSpkiSha256,
    signatureIndex: 0,
    revocationPolicy: {
      installUpdate: PUBLISHER_POLICY_INSTALL_REVOCATION,
      runtimeStartup: PUBLISHER_POLICY_RUNTIME_REVOCATION
    }
  };
  validatePublisherPolicyFields(policy);
  return Buffer.from(JSON.stringify(policy), "utf8");
}

export function createPublisherPolicyEnvelope({ payload, signature } = {}) {
  const payloadBytes = toPolicyBytes(payload, "publisher_policy_payload_size_invalid", 65536);
  const policy = parseCanonicalPublisherPolicyPayload(payloadBytes);
  const signatureBytes = toPolicyBytes(signature, "publisher_policy_signature_invalid", 1024);
  if (signatureBytes.length !== 384) throw new TypeError("publisher_policy_signature_size_invalid");
  const envelope = {
    format: PUBLISHER_POLICY_FORMAT,
    keyName: policy.keyName,
    payload: payloadBytes.toString("base64"),
    signature: signatureBytes.toString("base64")
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function verifyPublisherPolicyEnvelope({
  envelope,
  publicKeySpki,
  expectedInstallationId,
  expectedEdition
} = {}) {
  const envelopeBytes = toPolicyBytes(envelope, "publisher_policy_envelope_size_invalid", 131072);
  const envelopeText = envelopeBytes.toString("utf8");
  if (!Buffer.from(envelopeText, "utf8").equals(envelopeBytes)) {
    throw new TypeError("publisher_policy_envelope_encoding_invalid");
  }

  let parsedEnvelope;
  try {
    parsedEnvelope = JSON.parse(envelopeText);
  } catch {
    throw new TypeError("publisher_policy_envelope_json_invalid");
  }
  assertExactKeys(parsedEnvelope, PUBLISHER_POLICY_ENVELOPE_KEYS, "publisher_policy_envelope_schema_invalid");
  const canonicalEnvelope = {
    format: parsedEnvelope.format,
    keyName: parsedEnvelope.keyName,
    payload: parsedEnvelope.payload,
    signature: parsedEnvelope.signature
  };
  if (JSON.stringify(canonicalEnvelope) !== envelopeText || parsedEnvelope.format !== PUBLISHER_POLICY_FORMAT) {
    throw new TypeError("publisher_policy_envelope_noncanonical");
  }

  const payloadBytes = decodeCanonicalBase64(parsedEnvelope.payload, "publisher_policy_payload_base64_invalid", 65536);
  const signatureBytes = decodeCanonicalBase64(parsedEnvelope.signature, "publisher_policy_signature_base64_invalid", 1024);
  if (signatureBytes.length !== 384) throw new TypeError("publisher_policy_signature_size_invalid");

  const policy = parseCanonicalPublisherPolicyPayload(payloadBytes);
  if (parsedEnvelope.keyName !== policy.keyName) throw new TypeError("publisher_policy_envelope_key_mismatch");
  if (expectedInstallationId !== policy.installationId) throw new TypeError("publisher_policy_installation_mismatch");
  if (expectedEdition !== policy.edition) throw new TypeError("publisher_policy_edition_mismatch");

  let publicKey;
  try {
    const spkiBytes = typeof publicKeySpki === "string"
      ? decodeCanonicalBase64(publicKeySpki, "publisher_policy_verification_key_invalid", 8192)
      : toPolicyBytes(publicKeySpki, "publisher_policy_verification_key_invalid", 8192);
    publicKey = createPublicKey({ key: spkiBytes, format: "der", type: "spki" });
  } catch {
    throw new TypeError("publisher_policy_verification_key_invalid");
  }
  if (publicKey.asymmetricKeyType !== "rsa" || publicKey.asymmetricKeyDetails?.modulusLength !== 3072) {
    throw new TypeError("publisher_policy_verification_key_invalid");
  }

  let valid = false;
  try {
    valid = verifySignature(
      "sha256",
      payloadBytes,
      { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
      signatureBytes
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new TypeError("publisher_policy_signature_invalid");

  return policy;
}


function createUnsupportedMonotonicAnchorProvider() {
  return Object.freeze({
    async capabilities() {
      return Object.freeze({
        hardwareBacked: false,
        rollbackResistant: false,
        atomicCompareAndAdvance: false,
        durableAcrossRestart: false,
        scope: "windows-host-no-tpm-provider"
      });
    },
    async read() {
      return Object.freeze({ status: "unsupported" });
    },
    async advance() {
      throw new Error("monotonic_anchor_provider_unsupported");
    }
  });
}

function assertWindows(platform) {
  if (platform !== "win32") throw new Error("windows_host_requires_windows");
}

function sqliteAdapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec(`BEGIN ${mode}`);
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
        throw error;
      }
    };
    const wrapped = () => run("");
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  };
  return {
    exec: sql => database.exec(sql),
    prepare: sql => database.prepare(sql),
    transaction
  };
}

function runChecked(command, args, spawnImpl) {
  const result = spawnImpl(command, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("windows_host_command_failed_" + command.toLowerCase());
  }
  return String(result.stdout ?? "").trim();
}

export function resolveWindowsUserSid({ spawnImpl = spawnSync } = {}) {
  const output = runChecked("whoami.exe", ["/user", "/fo", "csv", "/nh"], spawnImpl);
  const sid = output.match(/S-1-(?:\d+-){1,14}\d+/)?.[0];
  if (!sid) throw new Error("windows_host_user_sid_unavailable");
  return sid;
}

export function applyWindowsPrivateAcl(path, {
  userSid,
  spawnImpl = spawnSync
} = {}) {
  if (typeof userSid !== "string" || !/^S-1-(?:\d+-){1,14}\d+$/.test(userSid)) {
    throw new TypeError("windows_host_user_sid_invalid");
  }
  const inheritance = statSync(path).isDirectory() ? "(OI)(CI)F" : "F";
  runChecked("icacls.exe", [
    path,
    "/inheritance:r",
    "/grant:r",
    `*${userSid}:${inheritance}`,
    `*S-1-5-18:${inheritance}`
  ], spawnImpl);
}

export function verifyAuthenticodeHelper(helperPath, {
  spawnImpl = spawnSync,
  expectedThumbprint
} = {}) {
  // Production startup intentionally has no environment fallback. Until the
  // installer-authenticated publisher policy is implemented, the default
  // host verifier fails closed because no trusted pin is supplied.
  if (typeof helperPath !== "string" || !isAbsolute(helperPath) || !existsSync(helperPath)) {
    throw new Error("windows_host_cng_helper_missing");
  }
  if (typeof expectedThumbprint !== "string" || !/^[A-Fa-f0-9]{40}$/.test(expectedThumbprint)) {
    throw new Error("windows_host_publisher_policy_unavailable");
  }
  const escaped = helperPath.replace(/'/g, "''");
  const thumbprint = expectedThumbprint.toUpperCase();
  const script = String.raw`$moduleRoot = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'; $env:PSModulePath = $moduleRoot + ';' + $env:PSModulePath; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $s = Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne '${thumbprint}') { exit 3 }`;
  runChecked("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "AllSigned",
    "-Command",
    script
  ], spawnImpl);
  return true;
}

function ensureRealDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const linkInfo = lstatSync(path);
  if (linkInfo.isSymbolicLink()) throw new Error("windows_host_data_path_redirected");
  const info = statSync(path);
  if (!info.isDirectory()) throw new Error("windows_host_data_path_not_directory");
  return resolve(path);
}

function rejectRedirectedFile(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("windows_host_data_file_redirected");
  }
}

function readOrCreateInstallationId(path, makeId = randomUUID) {
  rejectRedirectedFile(path);
  if (existsSync(path)) {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!INSTALLATION_ID_PATTERN.test(value?.installationId ?? "")) {
      throw new Error("windows_host_installation_id_corrupt");
    }
    return value.installationId;
  }
  const installationId = "officekit-" + makeId().replaceAll("-", "").toLowerCase();
  if (!INSTALLATION_ID_PATTERN.test(installationId)) throw new Error("windows_host_installation_id_invalid");
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({ installationId }) + "\n");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return installationId;
}

/**
 * Windows-only local host composition root.
 * No network listener, backend discovery, telemetry or automatic enrollment is started.
 * The helper must have a valid Authenticode signature before the database is opened.
 */
export function createWindowsHost({
  platform = process.platform,
  appDataPath = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "OfficeKit") : "",
  helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH ?? "",
  spawnImpl = spawnSync,
  resolveUserSid = () => resolveWindowsUserSid({ spawnImpl }),
  applyAcl = (path, userSid) => applyWindowsPrivateAcl(path, { userSid, spawnImpl }),
  verifyHelper = path => verifyAuthenticodeHelper(path, { spawnImpl }),
  databaseFactory = path => new DatabaseSync(path),
  runtimeFactory = createWindowsNodeIdentityRuntime,
  hardwareProbe = detectHostHardwareCapabilities,
  hardwareOptions = {},
  requestedProfile = "auto",
  requestedRenderer = "auto",
  now = Date.now,
  makeId = randomUUID,
  secretVaultFactory = options => new WindowsCngSecretVault(options),
  monotonicAnchorProviderFactory = () => createUnsupportedMonotonicAnchorProvider()
} = {}) {
  assertWindows(platform);
  if (typeof appDataPath !== "string" || !isAbsolute(appDataPath)) {
    throw new TypeError("windows_host_app_data_path_must_be_absolute");
  }
  if (typeof helperPath !== "string" || !isAbsolute(helperPath)) {
    throw new TypeError("windows_host_cng_helper_path_must_be_absolute");
  }
  if (typeof runtimeFactory !== "function" || typeof databaseFactory !== "function"
    || typeof hardwareProbe !== "function" || typeof secretVaultFactory !== "function"
    || typeof monotonicAnchorProviderFactory !== "function") {
    throw new TypeError("windows_host_factories_required");
  }

  const root = resolve(appDataPath);
  const dataDirectory = join(root, "data");
  const identityPath = join(root, "installation.json");
  const databasePath = join(dataDirectory, "office-kit.sqlite");
  const lockPath = join(root, "host.lock");
  let database;
  let runtime;
  let installationId;
  let releaseLock;
  let operationLockProvider;
  let monotonicCheckpointJournal;
  let monotonicCheckpointCoordinator;
  let monotonicAnchorProvider;
  let incidentProtectionState = Object.freeze({ status: "initializing", rollbackProtection: "unavailable" });
  let monotonicAnchorEverProtected = false;
  let hardwareCapabilities;
  let resourcePolicy;
  let profileOverride = requestedProfile;
  let rendererOverride = requestedRenderer;
  let closed = false;
  const managedGateways = new Set();

  try {
    ensureRealDirectory(root);
    const userSid = resolveUserSid();
    applyAcl(root, userSid);
    releaseLock = acquireWindowsHostProcessLock(lockPath, { now });
    operationLockProvider = createInProcessExclusiveLockProvider();
    applyAcl(lockPath, userSid);
    ensureRealDirectory(dataDirectory);
    applyAcl(dataDirectory, userSid);
    hardwareCapabilities = hardwareProbe({ ...hardwareOptions, storagePath: dataDirectory });
    resourcePolicy = resolveAdaptiveResourcePolicy({
      capabilities: hardwareCapabilities,
      requestedProfile: profileOverride,
      requestedRenderer: rendererOverride
    });
    if (!existsSync(helperPath)) throw new Error("windows_host_cng_helper_missing");
    if (verifyHelper(helperPath) !== true) throw new Error("windows_host_cng_helper_untrusted");

    installationId = readOrCreateInstallationId(identityPath, makeId);
    applyAcl(identityPath, userSid);
    monotonicAnchorProvider = monotonicAnchorProviderFactory({ installationId, platform, dataDirectory });
    if (!monotonicAnchorProvider || typeof monotonicAnchorProvider.read !== "function"
      || typeof monotonicAnchorProvider.advance !== "function"
      || typeof monotonicAnchorProvider.capabilities !== "function") {
      throw new TypeError("windows_host_monotonic_anchor_provider_invalid");
    }

    rejectRedirectedFile(databasePath);
    database = databaseFactory(databasePath);
    applyAcl(databasePath, userSid);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    runtime = runtimeFactory({
      database: sqliteAdapter(database),
      installationId,
      hostExecutable: helperPath
    });
    var incidentStore = new SqliteOfficeIncidentStore({
      database: sqliteAdapter(database),
      installationId,
      requireMac: true,
      writeLockProvider: operationLockProvider,
      cryptoProvider: {
        sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"),
        randomUUID
      }
    });
    monotonicCheckpointJournal = new SqliteMonotonicCheckpointJournal({
      database: sqliteAdapter(database),
      installationId,
      lockProvider: operationLockProvider,
      applyPreparedPayload: (payload, checkpoint) => (
        incidentStore.applyPreparedMonotonicPayload(payload, checkpoint)
      )
    });
    monotonicCheckpointCoordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: monotonicAnchorProvider,
      journal: monotonicCheckpointJournal,
      installationId
    });
    var installationLifecycleStore = new SqliteInstallationLifecycleStore({
      database: sqliteAdapter(database),
      installationId,
      clock: now
    });
  } catch (error) {
    try { database?.close(); } catch { /* Preserve initialization error. */ }
    try { releaseLock?.(); } catch { /* Preserve initialization error. */ }
    throw error;
  }

  const incidentMacKeys = new Map();
  let activeIncidentMacKeyId = null;
  let incidentJournalVault = null;

  function incidentMacSecretName(keyId) {
    const match = /^windows-cng:incident-journal-mac-v([1-9][0-9]{0,2})$/.exec(keyId);
    if (!match) throw new Error("incident_integrity_key_id_invalid");
    return "journal-mac-v" + match[1];
  }

  function createIncidentMacProvider(keyId, key) {
    return Object.freeze({
      keyId,
      hmacSha256Hex: value => createHmac("sha256", key).update(value, "utf8").digest("hex")
    });
  }

  function decodeIncidentMacKey(encodedKey) {
    if (typeof encodedKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) {
      throw new Error("incident_integrity_key_invalid");
    }
    const key = Buffer.from(encodedKey, "base64url");
    if (key.length !== 32 || key.toString("base64url") !== encodedKey) {
      key.fill(0);
      throw new Error("incident_integrity_key_invalid");
    }
    return key;
  }

  const ready = Promise.resolve().then(async () => {
    incidentJournalVault = createSecretStore("incident.journal");
    const storedActiveId = await incidentJournalVault.getSecret("journal-mac-active");
    const historicalIds = incidentStore.getMacKeyIds();
    if (storedActiveId === null && historicalIds.some(keyId => keyId !== "windows-cng:incident-journal-mac-v1")) {
      throw new Error("incident_active_key_pointer_missing_recovery_required");
    }
    const activeId = storedActiveId ?? "windows-cng:incident-journal-mac-v1";
    const requiredIds = new Set([...historicalIds, activeId]);

    for (const keyId of requiredIds) {
      const secretName = incidentMacSecretName(keyId);
      let encodedKey = await incidentJournalVault.getSecret(secretName);
      if (encodedKey === null) {
        if (incidentStore.hasMacRecords() || storedActiveId !== null) {
          throw new Error("incident_integrity_key_missing_recovery_required");
        }
        const generated = randomBytes(32);
        try { encodedKey = generated.toString("base64url"); }
        finally { generated.fill(0); }
        await incidentJournalVault.setSecret(secretName, encodedKey);
      }
      incidentMacKeys.set(keyId, decodeIncidentMacKey(encodedKey));
    }

    if (storedActiveId === null) {
      await incidentJournalVault.setSecret("journal-mac-active", activeId);
    }
    activeIncidentMacKeyId = activeId;
    incidentStore.configureMacKeyring({
      providers: [...incidentMacKeys].map(([keyId, key]) => createIncidentMacProvider(keyId, key)),
      activeKeyId: activeId
    });
    await refreshIncidentProtectionState();
    return runtime.manager.reconcile();
  });
  async function refreshIncidentProtectionState() {
    const enrolled = await incidentJournalVault.getSecret("monotonic-anchor-enrolled");
    if (enrolled !== null && enrolled !== "true") {
      throw new Error("windows_host_monotonic_enrollment_marker_corrupt");
    }
    monotonicAnchorEverProtected = enrolled === "true";
    const recovered = await monotonicCheckpointCoordinator.recover();

    if (recovered.status === "protected") {
      if (!monotonicAnchorEverProtected) {
        await incidentJournalVault.setSecret("monotonic-anchor-enrolled", "true");
        monotonicAnchorEverProtected = true;
      }
      const integrity = incidentStore.verifyIntegrity();
      if (integrity.eventCount !== recovered.checkpoint.sequence
        || integrity.headHash !== recovered.checkpoint.eventHash
        || integrity.headMac !== recovered.checkpoint.eventMac) {
        throw new Error("windows_host_incident_checkpoint_store_mismatch");
      }
      incidentProtectionState = Object.freeze({
        ...recovered,
        integrity: "sha256_plus_keystore_hmac_plus_monotonic",
        writeEnabled: true,
        hardwareBacked: true
      });
      return incidentProtectionState;
    }

    if (monotonicAnchorEverProtected) {
      incidentProtectionState = Object.freeze({
        status: "recovery_required",
        rollbackProtection: "unavailable",
        reason: "previously_protected_anchor_unavailable",
        localCheckpoint: recovered.localCheckpoint ?? null,
        writeEnabled: false,
        hardwareBacked: false
      });
      return incidentProtectionState;
    }

    const prepared = await monotonicCheckpointJournal.readPreparedCheckpoint();
    if (recovered.status === "unsupported" && !prepared
      && Number(recovered.localCheckpoint?.generation ?? 0) === 0) {
      const integrity = incidentStore.verifyIntegrity();
      if (integrity.verification !== "sha256_plus_keystore_hmac") {
        throw new Error("windows_host_authenticated_journal_unverified");
      }
      incidentProtectionState = Object.freeze({
        status: "authenticated_only",
        integrity: "sha256_plus_keystore_hmac",
        rollbackProtection: "unsupported",
        localCheckpoint: recovered.localCheckpoint,
        writeEnabled: true,
        hardwareBacked: false
      });
      return incidentProtectionState;
    }

    incidentProtectionState = Object.freeze({
      ...recovered,
      writeEnabled: false,
      hardwareBacked: false
    });
    return incidentProtectionState;
  }

  async function ensureReady() {
    const result = await ready;
    if (!["empty", "active", "revoked"].includes(result?.status)) {
      throw new Error("windows_host_startup_reconciliation_incomplete");
    }
    return result;
  }

  const monotonicIncidentWriter = new MonotonicIncidentWriter({ incidentStore, coordinator: monotonicCheckpointCoordinator });
  const publicIncidentStore = Object.freeze({
    append: async incident => {
      if (closed) throw new Error("windows_host_stopped");
      await ensureReady();
      await refreshIncidentProtectionState();
      if (incidentProtectionState.status === "protected") return monotonicIncidentWriter.append(incident);
      if (incidentProtectionState.status === "authenticated_only") return incidentStore.append(incident);
      throw new Error("windows_host_incident_writes_unavailable");
    },
    update: async (id, patch) => {
      if (closed) throw new Error("windows_host_stopped");
      await ensureReady();
      await refreshIncidentProtectionState();
      if (incidentProtectionState.status === "protected") return monotonicIncidentWriter.update(id, patch);
      if (incidentProtectionState.status === "authenticated_only") return incidentStore.update(id, patch);
      throw new Error("windows_host_incident_writes_unavailable");
    },
    get: async id => {
      if (closed) throw new Error("windows_host_stopped");
      await ensureReady();
      return incidentStore.get(id);
    },
    list: async options => {
      if (closed) throw new Error("windows_host_stopped");
      await ensureReady();
      return incidentStore.list(options);
    },
    export: async options => {
      if (closed) throw new Error("windows_host_stopped");
      await ensureReady();
      return incidentStore.export(options);
    },
    listEvents: () => {
      if (closed) throw new Error("windows_host_stopped");
      return incidentStore.listEvents();
    },
    verifyIntegrity: () => {
      if (closed) throw new Error("windows_host_stopped");
      return incidentStore.verifyIntegrity();
    }
  });

  async function getIncidentProtectionState() {
    if (closed) throw new Error("windows_host_stopped");
    await ready;
    return await refreshIncidentProtectionState();
  }

  const manager = Object.freeze({
    create: async input => {
      await ensureReady();
      return runtime.manager.create(input);
    },
    rotate: async () => {
      await ensureReady();
      return runtime.manager.rotate();
    },
    revoke: async () => {
      await ensureReady();
      return runtime.manager.revoke();
    },
    getPublicIdentity: async () => {
      await ensureReady();
      return runtime.manager.getPublicIdentity();
    },
    reconcile: async () => {
      await ensureReady();
      return runtime.manager.reconcile();
    }
  });

  async function rotateIncidentJournalMacKey({ ownerConsent = false } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    if (ownerConsent !== true) throw new Error("incident_key_rotation_owner_consent_required");
    await ready;
    return monotonicCheckpointJournal.withExclusiveLock(async () => {
      if (closed) throw new Error("windows_host_stopped");
      if (incidentMacKeys.size >= 32) throw new Error("incident_key_rotation_limit_reached");
    const currentMatch = /^windows-cng:incident-journal-mac-v([1-9][0-9]{0,2})$/.exec(activeIncidentMacKeyId ?? "");
    if (!currentMatch) throw new Error("incident_integrity_key_id_invalid");
    const nextVersion = Number(currentMatch[1]) + 1;
    if (nextVersion > 999) throw new Error("incident_key_rotation_limit_reached");
    const nextKeyId = "windows-cng:incident-journal-mac-v" + nextVersion;
    const nextSecretName = incidentMacSecretName(nextKeyId);
    if (await incidentJournalVault.getSecret(nextSecretName) !== null) {
      throw new Error("incident_key_rotation_version_already_exists");
    }

    const generated = randomBytes(32);
    let encodedKey;
    let nextKey;
    const previousActiveId = activeIncidentMacKeyId;
    try {
      encodedKey = generated.toString("base64url");
      nextKey = Buffer.from(generated);
      await incidentJournalVault.setSecret(nextSecretName, encodedKey);
      // Persist the intended active version before switching the in-memory signer.
      // On restart, startup loads every historical key ID plus this active pointer.
      await incidentJournalVault.setSecret("journal-mac-active", nextKeyId);
      const nextKeys = new Map(incidentMacKeys);
      nextKeys.set(nextKeyId, nextKey);
      incidentStore.configureMacKeyring({
        providers: [...nextKeys].map(([keyId, key]) => createIncidentMacProvider(keyId, key)),
        activeKeyId: nextKeyId
      });
      incidentMacKeys.set(nextKeyId, nextKey);
      nextKey = null;
      activeIncidentMacKeyId = nextKeyId;
      return Object.freeze({
        rotated: true,
        previousKeyId: previousActiveId,
        activeKeyId: nextKeyId,
        retainedKeyIds: Object.freeze([...incidentMacKeys.keys()].sort()),
        historicalKeysRetained: true
      });
    } catch (error) {
      try { await incidentJournalVault.setSecret("journal-mac-active", previousActiveId); }
      catch { /* A persisted new pointer remains recoverable because its key was stored first. */ }
      throw error;
      } finally {
        generated.fill(0);
        nextKey?.fill(0);
      }
    });
  }

  function getIncidentJournalKeyState() {
    if (closed) throw new Error("windows_host_stopped");
    return Object.freeze({
      activeKeyId: activeIncidentMacKeyId,
      retainedKeyIds: Object.freeze([...incidentMacKeys.keys()].sort()),
      rotationRequiresOwnerConsent: true,
      automaticRetirement: false
    });
  }

  async function health() {
    if (closed) return Object.freeze({ status: "stopped", identityStatus: "unknown" });
    await ready;
    const incidentProtection = await getIncidentProtectionState();
    const reconciliation = await runtime.manager.reconcile();
    const identityStatus = reconciliation.status;
    const healthy = identityStatus === "empty" || identityStatus === "active" || identityStatus === "revoked";
    const identity = healthy ? await runtime.manager.getPublicIdentity() : null;
    return Object.freeze({
      status: healthy ? "ready" : "degraded",
      identityStatus,
      installationId,
      incidentProtection,
      identity: identity ? Object.freeze({
        organizationId: identity.organizationId,
        nodeId: identity.nodeId,
        generation: identity.generation,
        algorithm: identity.algorithm,
        identityFingerprint: identity.identityFingerprint
      }) : null,
      capabilities: runtime.capabilities,
      hardware: JSON.parse(JSON.stringify(hardwareCapabilities ?? {})),
      resourcePolicy: JSON.parse(JSON.stringify(resourcePolicy ?? {}))
    });
  }

  function refreshResourcePolicy({ measurements = {} } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    hardwareCapabilities = hardwareProbe({ ...hardwareOptions, storagePath: dataDirectory });
    resourcePolicy = resolveAdaptiveResourcePolicy({
      capabilities: hardwareCapabilities,
      measurements,
      previousPolicy: resourcePolicy,
      requestedProfile: profileOverride,
      requestedRenderer: rendererOverride
    });
    return structuredClone(resourcePolicy);
  }

  function setResourceOverrides({ profile = "auto", renderer = "auto" } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    const nextPolicy = resolveAdaptiveResourcePolicy({
      capabilities: hardwareCapabilities,
      previousPolicy: resourcePolicy,
      requestedProfile: profile,
      requestedRenderer: renderer
    });
    profileOverride = profile;
    rendererOverride = renderer;
    resourcePolicy = nextPolicy;
    return structuredClone(resourcePolicy);
  }

  function getResourcePolicy() {
    return structuredClone(resourcePolicy);
  }

  async function close() {
    if (closed) return;
    closed = true;
    await Promise.allSettled([...managedGateways].map(gateway => gateway.close()));
    try { await ready; } catch { /* Initialization failure must not leak the database or lock. */ }
    await operationLockProvider?.close();
    for (const key of incidentMacKeys.values()) key.fill(0);
    incidentMacKeys.clear();
    activeIncidentMacKeyId = null;
    try { database.close(); }
    finally {
      releaseLock?.();
      releaseLock = null;
    }
  }

  function createInstallationLifecycleRuntime({ driver, clock = now } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    const lifecycle = createInstallationLifecycleController({
      driver,
      store: installationLifecycleStore,
      clock
    });
    return Object.freeze({
      ...lifecycle,
      install: ({ installationId: requestedInstallationId, ...input } = {}) => {
        if (requestedInstallationId !== installationId) {
          throw new Error("windows_host_installation_id_mismatch");
        }
        return lifecycle.install({ ...input, installationId });
      }
    });
  }

  function createSecretStore(namespace) {
    if (closed) throw new Error("windows_host_stopped");
    return secretVaultFactory({
      database: sqliteAdapter(database),
      installationId,
      namespace,
      hostExecutable: helperPath,
      platform
    });
  }

  function createDiagnostics({ probes, recoveryActions = [], clock } = {}) {
    return new OfficeHealthRecoveryEngine({
      probes,
      incidentStore: publicIncidentStore,
      recoveryActions,
      ...(typeof clock === "function" ? { clock } : {})
    });
  }

  /**
   * Creates an explicitly selected, read-only adapter gateway whose authoritative
   * RuntimeSession transitions are supervised and persisted by this host.
   * Authentication/authorization remains the caller's responsibility.
   */
  function createManagedAdapterGateway({
    probes,
    recoveryActions = [],
    clock,
    ttlMs = 30_000,
    maxEventAgeMs = ttlMs,
    maxBufferedEvents = 256,
    edition = "universal",
    officeKitVersion = "0.1.0"
  } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    if (!Array.isArray(probes) || probes.length === 0) {
      throw new TypeError("managed_gateway_requires_read_only_diagnostic_probes");
    }
    const healthEngine = createDiagnostics({ probes, recoveryActions, clock });
    const supervisor = new OfficeConnectionSupervisor({ healthEngine });
    const gateway = new AdapterGateway({ ttlMs, maxEventAgeMs, maxBufferedEvents });
    let adapterId = "unselected";
    let pending = Promise.resolve();
    let lastSupervisionFailure = false;
    let disposed = false;
    const context = () => ({ edition, officeKitVersion, adapterId });

    const enqueueObservation = state => {
      if (disposed || !state) return;
      pending = pending.then(
        () => supervisor.observe(state, context()),
        () => supervisor.observe(state, context())
      ).catch(() => { lastSupervisionFailure = true; });
    };
    gateway.onEvent(event => enqueueObservation(event.state));

    async function synchronize() {
      const state = gateway.getState();
      enqueueObservation(state);
      await pending;
      return state;
    }

    const managed = Object.freeze({
      connect: async adapter => {
        if (disposed) throw new Error("managed_gateway_closed");
        await ensureReady();
        if (!adapter?.metadata?.id || typeof adapter.metadata.id !== "string") {
          throw new TypeError("managed_gateway_adapter_identity_required");
        }
        adapterId = adapter.metadata.id;
        const result = await gateway.connect(adapter);
        await synchronize();
        return Object.freeze({
          ...result,
          supervision: supervisor.getState(),
          supervisionDegraded: lastSupervisionFailure
        });
      },
      receiveEvent: async event => {
        if (disposed) throw new Error("managed_gateway_closed");
        await ensureReady();
        const result = gateway.receiveEvent(event);
        await synchronize();
        return result;
      },
      checkHealth: async () => {
        if (disposed) throw new Error("managed_gateway_closed");
        await ensureReady();
        const state = gateway.checkHealth();
        enqueueObservation(state);
        await pending;
        return state;
      },
      disconnect: async () => {
        if (disposed) return { state: gateway.getState(), error: null };
        await ensureReady();
        const result = await gateway.disconnect();
        await synchronize();
        return result;
      },
      getState: () => {
        if (disposed || closed) throw new Error("managed_gateway_closed");
        return gateway.getState();
      },
      getSupervisorState: () => Object.freeze({
        ...supervisor.getState(),
        supervisionDegraded: lastSupervisionFailure
      }),
      close: async () => {
        if (disposed) return;
        await ensureReady();
        await gateway.disconnect();
        await synchronize();
        disposed = true;
        managedGateways.delete(managed);
      }
    });
    managedGateways.add(managed);
    return managed;
  }

  return Object.freeze({
    installationId,
    incidentStore: publicIncidentStore,
    installationLifecycleStore,
    createInstallationLifecycleRuntime,
    createDiagnostics,
    createSecretStore,
    rotateIncidentJournalMacKey,
    getIncidentJournalKeyState,
    getIncidentProtectionState,
    getResourcePolicy,
    refreshResourcePolicy,
    setResourceOverrides,
    databasePath,
    helperPath,
    ready,
    manager,
    health,
    createManagedAdapterGateway,
    close
  });
}
