import { spawn } from "node:child_process";
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes
} from "node:crypto";
import { isAbsolute } from "node:path";

const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MAX_SECRET_BYTES = 8_192;
const MAX_HOST_OUTPUT_BYTES = 64 * 1024;
const ENVELOPE_ALGORITHM = "AES-256-GCM+RSA-OAEP-SHA256";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("windows_cng_secret_" + label + "_encoding_invalid");
  }
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || encode(decoded) !== value) {
    throw new TypeError("windows_cng_secret_" + label + "_encoding_invalid");
  }
  return decoded;
}

function validateName(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(code);
  return value;
}

function runImmediate(database, operation) {
  const transaction = database.transaction(operation);
  if (!transaction || typeof transaction.immediate !== "function") {
    throw new TypeError("windows_cng_secret_immediate_transaction_required");
  }
  return transaction.immediate();
}

/**
 * Installation- and namespace-scoped Windows secret vault.
 *
 * A non-exportable RSA private key is held by the Windows CNG Software KSP.
 * It wraps a random AES-256-GCM data key; SQLite stores only the authenticated
 * ciphertext envelope. This is OS-protected software storage, not TPM-backed.
 */
export class WindowsCngSecretVault {
  #database;
  #installationId;
  #namespace;
  #hostExecutable;
  #spawn;
  #timeoutMs;

  constructor({
    database,
    installationId,
    namespace,
    hostExecutable,
    spawnImpl = spawn,
    timeoutMs = 10_000,
    platform = process.platform
  } = {}) {
    if (platform !== "win32") throw new Error("windows_cng_secret_vault_requires_windows");
    if (!database || typeof database.exec !== "function"
      || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("windows_cng_secret_database_required");
    }
    if (typeof installationId !== "string" || !INSTALLATION_ID_PATTERN.test(installationId)) {
      throw new TypeError("windows_cng_secret_installation_id_invalid");
    }
    validateName(namespace, NAMESPACE_PATTERN, "windows_cng_secret_namespace_invalid");
    if (typeof hostExecutable !== "string" || !isAbsolute(hostExecutable)) {
      throw new TypeError("windows_cng_secret_host_executable_must_be_absolute");
    }
    if (typeof spawnImpl !== "function") throw new TypeError("windows_cng_secret_spawn_required");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      throw new TypeError("windows_cng_secret_timeout_invalid");
    }

    const transaction = database.transaction(() => {});
    if (!transaction || typeof transaction.immediate !== "function") {
      throw new TypeError("windows_cng_secret_immediate_transaction_required");
    }

    this.#database = database;
    this.#installationId = installationId;
    this.#namespace = namespace;
    this.#hostExecutable = hostExecutable;
    this.#spawn = spawnImpl;
    this.#timeoutMs = timeoutMs;

    this.#database.exec([
      "CREATE TABLE IF NOT EXISTS office_kit_protected_secrets (",
      "  installation_id TEXT NOT NULL,",
      "  namespace TEXT NOT NULL,",
      "  secret_name TEXT NOT NULL,",
      "  envelope_json TEXT NOT NULL,",
      "  updated_at TEXT NOT NULL,",
      "  PRIMARY KEY (installation_id, namespace, secret_name)",
      ");"
    ].join("\n"));
  }

  getCapabilities() {
    return Object.freeze({
      providerId: "windows-cng-software-ksp-secret-vault",
      persistent: true,
      protectionLevel: "os-protected",
      hardwareBacked: false,
      privateKeyNonExportable: true,
      keyScope: "current-user-profile+installation+namespace",
      backupRestoreRequiresSameUserProfile: true,
      envelopeEncryption: ENVELOPE_ALGORITHM,
      storage: "installation-scoped-sqlite-ciphertext"
    });
  }

  async setSecret(name, secret) {
    validateName(name, SECRET_NAME_PATTERN, "windows_cng_secret_name_invalid");
    if (typeof secret !== "string" || secret.length === 0
      || Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) {
      throw new TypeError("windows_cng_secret_value_invalid");
    }

    let plaintext;
    let dataKey;
    try {
      const publicKeyResponse = await this.#invoke("secret-public-key");
      if (publicKeyResponse.privateKeyNonExportable !== true
        || publicKeyResponse.protectionLevel !== "os-protected"
        || publicKeyResponse.hardwareBacked !== false
        || !Number.isSafeInteger(publicKeyResponse.keySize)
        || publicKeyResponse.keySize < 2_048) {
        throw new Error("windows_cng_secret_key_policy_invalid");
      }

      const publicKeyBytes = decode(publicKeyResponse.publicKey, "public_key");
      const publicKey = createPublicKey({
        key: publicKeyBytes,
        format: "der",
        type: "spki"
      });
      plaintext = Buffer.from(secret, "utf8");
      dataKey = randomBytes(32);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
      cipher.setAAD(this.#associatedData(name));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const wrappedKey = publicEncrypt({
        key: publicKey,
        oaepHash: "sha256",
        padding: constants.RSA_PKCS1_OAEP_PADDING
      }, dataKey);

      const envelope = JSON.stringify({
        schemaVersion: 1,
        algorithm: ENVELOPE_ALGORITHM,
        wrappedKey: encode(wrappedKey),
        nonce: encode(nonce),
        tag: encode(tag),
        ciphertext: encode(ciphertext)
      });
      const updatedAt = new Date().toISOString();
      runImmediate(this.#database, () => {
        this.#database.prepare([
          "INSERT INTO office_kit_protected_secrets",
          "(installation_id, namespace, secret_name, envelope_json, updated_at)",
          "VALUES (?, ?, ?, ?, ?)",
          "ON CONFLICT (installation_id, namespace, secret_name)",
          "DO UPDATE SET envelope_json = excluded.envelope_json, updated_at = excluded.updated_at"
        ].join(" ")).run(
          this.#installationId,
          this.#namespace,
          name,
          envelope,
          updatedAt
        );
      });
      return Object.freeze({ stored: true, name, updatedAt });
    } catch (error) {
      if (error?.message === "windows_cng_secret_key_policy_invalid") throw error;
      if (typeof error?.message === "string" && /^windows_cng_[a-z0-9_]+$/.test(error.message)) throw error;
      throw new Error("windows_cng_secret_protection_failed");
    } finally {
      plaintext?.fill(0);
      dataKey?.fill(0);
    }
  }

  async getSecret(name, { signal } = {}) {
    validateName(name, SECRET_NAME_PATTERN, "windows_cng_secret_name_invalid");
    if (signal?.aborted) throw new Error("windows_cng_secret_cancelled");
    const row = this.#database.prepare([
      "SELECT envelope_json FROM office_kit_protected_secrets",
      "WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ].join(" ")).get(this.#installationId, this.#namespace, name);
    if (!row) return null;

    let dataKey;
    let plaintext;
    try {
      const envelope = JSON.parse(row.envelope_json);
      if (!envelope || envelope.schemaVersion !== 1 || envelope.algorithm !== ENVELOPE_ALGORITHM) {
        throw new Error("invalid_envelope");
      }
      const wrappedKey = decode(envelope.wrappedKey, "wrapped_key");
      const nonce = decode(envelope.nonce, "nonce");
      const tag = decode(envelope.tag, "tag");
      const ciphertext = decode(envelope.ciphertext, "ciphertext");
      if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_SECRET_BYTES) {
        throw new Error("invalid_envelope");
      }

      const result = await this.#invoke("secret-decrypt-key", { wrappedKey: encode(wrappedKey) }, { signal });
      dataKey = decode(result.key, "data_key");
      if (dataKey.length !== 32) throw new Error("invalid_data_key");
      const decipher = createDecipheriv("aes-256-gcm", dataKey, nonce);
      decipher.setAAD(this.#associatedData(name));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (plaintext.length === 0 || plaintext.length > MAX_SECRET_BYTES) throw new Error("invalid_plaintext");
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch (error) {
      if (signal?.aborted || error?.message === "windows_cng_secret_cancelled") {
        throw new Error("windows_cng_secret_cancelled");
      }
      throw new Error("windows_cng_secret_decryption_failed");
    } finally {
      dataKey?.fill(0);
      plaintext?.fill(0);
    }
  }

  hasSecret(name) {
    validateName(name, SECRET_NAME_PATTERN, "windows_cng_secret_name_invalid");
    const row = this.#database.prepare([
      "SELECT 1 AS present FROM office_kit_protected_secrets",
      "WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ].join(" ")).get(this.#installationId, this.#namespace, name);
    return Boolean(row);
  }

  deleteSecret(name) {
    validateName(name, SECRET_NAME_PATTERN, "windows_cng_secret_name_invalid");
    return runImmediate(this.#database, () => {
      const result = this.#database.prepare([
        "DELETE FROM office_kit_protected_secrets",
        "WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
      ].join(" ")).run(this.#installationId, this.#namespace, name);
      return Number(result.changes) === 1;
    });
  }

  async checkNonExportable() {
    const result = await this.#invoke("secret-check-export");
    return result.exists === true && result.exportable === false;
  }

  async destroy() {
    const deletedCount = runImmediate(this.#database, () => {
      const result = this.#database.prepare([
        "DELETE FROM office_kit_protected_secrets",
        "WHERE installation_id = ? AND namespace = ?"
      ].join(" ")).run(this.#installationId, this.#namespace);
      return Number(result.changes);
    });
    try {
      const result = await this.#invoke("secret-delete-key");
      return Object.freeze({ deletedCount, keyDeleted: result.deleted === true });
    } catch {
      return Object.freeze({ deletedCount, keyDeleted: false });
    }
  }

  #associatedData(name) {
    return Buffer.from(this.#installationId + "\0" + this.#namespace + "\0" + name, "utf8");
  }

  #invoke(command, fields = {}, { signal } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let child;
      let removeAbort = () => {};
      let timer;

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeAbort();
        if (error) reject(error);
        else resolve(value);
      };

      timer = setTimeout(() => {
        finish(new Error("windows_cng_secret_host_timeout"));
        try { child?.kill(); } catch { /* Process may already have exited. */ }
      }, this.#timeoutMs);
      timer.unref?.();
      if (signal?.aborted) {
        finish(new Error("windows_cng_secret_cancelled"));
        return;
      }
      if (signal) {
        const onAbort = () => {
          finish(new Error("windows_cng_secret_cancelled"));
          try { child?.kill(); } catch { /* Process may already have exited. */ }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => signal.removeEventListener("abort", onAbort);
      }

      try {
        child = this.#spawn(this.#hostExecutable, [], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch {
        finish(new Error("windows_cng_secret_host_start_failed"));
        return;
      }

      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", chunk => {
        stdout += chunk;
        if (Buffer.byteLength(stdout, "utf8") > MAX_HOST_OUTPUT_BYTES) {
          finish(new Error("windows_cng_secret_host_output_too_large"));
          try { child.kill(); } catch { /* Process may already have exited. */ }
        }
      });
      child.stderr?.on("data", chunk => {
        stderr += chunk;
        if (Buffer.byteLength(stderr, "utf8") > MAX_HOST_OUTPUT_BYTES) stderr = stderr.slice(-4096);
      });
      child.on("error", () => finish(new Error("windows_cng_secret_host_start_failed")));
      child.on("close", code => {
        if (settled) return;
        let response;
        try { response = JSON.parse(stdout.trim()); }
        catch {
          finish(new Error(code === 0
            ? "windows_cng_secret_host_invalid_response"
            : "windows_cng_secret_host_failed"));
          return;
        }
        if (code !== 0 || response?.ok !== true) {
          const safeError = typeof response?.error === "string" && /^[a-z0-9_]+$/.test(response.error)
            ? response.error
            : "windows_cng_secret_host_failed";
          finish(new Error(safeError));
          return;
        }
        finish(null, response);
      });

      try {
        child.stdin.end(JSON.stringify({
          command,
          installationId: this.#installationId,
          namespace: this.#namespace,
          ...fields
        }) + "\n");
      } catch {
        finish(new Error("windows_cng_secret_host_write_failed"));
      }
    });
  }
}
