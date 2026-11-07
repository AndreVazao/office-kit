import { spawn } from "node:child_process";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { isAbsolute } from "node:path";
import { NodeKeyStoreProvider } from "./node-identity.mjs";

const ALGORITHM = "ECDSA-P256-SHA256";
const KEY_ID_PATTERN = /^ok-[a-f0-9]{16}-[a-f0-9]{32}$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const MAX_HOST_OUTPUT_BYTES = 64 * 1024;

function byteArray(value, label, expectedLength) {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new TypeError(label + "_must_be_non_empty_bytes");
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    throw new TypeError(label + "_must_be_" + expectedLength + "_bytes");
  }
  return value;
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("invalid_" + label + "_base64url");
  }
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/**
 * Windows CNG Software KSP provider for non-exportable ECDSA P-256 keys.
 *
 * The native helper creates a persisted user-scoped CNG key with ExportPolicy.None.
 * Only public key bytes and opaque, installation-scoped key names cross this bridge.
 * This provider is OS-protected but deliberately does not claim TPM/hardware backing.
 */
export class WindowsCngP256KeyStore extends NodeKeyStoreProvider {
  #hostExecutable;
  #installationId;
  #keyPrefix;
  #spawn;
  #timeoutMs;

  constructor({
    hostExecutable,
    installationId,
    spawnImpl = spawn,
    timeoutMs = 10_000
  } = {}) {
    super();
    if (process.platform !== "win32") throw new Error("windows_cng_provider_requires_windows");
    if (typeof hostExecutable !== "string" || !isAbsolute(hostExecutable)) {
      throw new TypeError("windows_cng_host_executable_must_be_absolute");
    }
    if (typeof installationId !== "string" || !INSTALLATION_ID_PATTERN.test(installationId)) {
      throw new TypeError("invalid_identity_installation_id");
    }
    if (typeof spawnImpl !== "function") throw new TypeError("windows_cng_spawn_required");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) {
      throw new TypeError("windows_cng_timeout_invalid");
    }

    this.#hostExecutable = hostExecutable;
    this.#installationId = installationId;
    this.#keyPrefix = "ok-" + createHash("sha256").update(installationId).digest("hex").slice(0, 16) + "-";
    this.#spawn = spawnImpl;
    this.#timeoutMs = timeoutMs;
  }

  getCapabilities() {
    return Object.freeze({
      providerId: "windows-cng-software-ksp",
      persistent: true,
      protectionLevel: "os-protected",
      hardwareBacked: false,
      privateKeyNonExportable: true,
      algorithms: Object.freeze([ALGORITHM])
    });
  }

  async createKeyPair({ algorithm = ALGORITHM } = {}) {
    if (algorithm !== ALGORITHM) throw new Error("keystore_algorithm_unsupported");
    const result = await this.#invoke("create");
    if (result.algorithm !== ALGORITHM || typeof result.keyId !== "string" || !this.#isScopedKeyId(result.keyId)) {
      throw new Error("windows_cng_host_invalid_key_response");
    }
    return Object.freeze({
      keyId: result.keyId,
      publicKey: decode(result.publicKey, "public_key"),
      algorithm: ALGORITHM
    });
  }

  async sign(keyId, message, algorithm = ALGORITHM) {
    if (algorithm !== ALGORITHM) throw new Error("keystore_algorithm_unsupported");
    this.#assertScopedKeyId(keyId);
    const result = await this.#invoke("sign", {
      keyId,
      message: encode(byteArray(message, "message"))
    });
    return decode(result.signature, "signature");
  }

  async deleteKey(keyId) {
    this.#assertScopedKeyId(keyId);
    const result = await this.#invoke("delete", { keyId });
    return result.deleted === true;
  }

  async hasKey(keyId) {
    if (!this.#isScopedKeyId(keyId)) return false;
    const result = await this.#invoke("has", { keyId });
    return result.exists === true;
  }

  /** Diagnostic probe used by native integration tests; true means export was refused by CNG. */
  async checkNonExportable(keyId) {
    this.#assertScopedKeyId(keyId);
    const result = await this.#invoke("check-export", { keyId });
    return result.exportable === false;
  }

  async verify(publicKey, message, signature, algorithm = ALGORITHM) {
    if (algorithm !== ALGORITHM) return false;
    try {
      const raw = byteArray(publicKey, "public_key", 65);
      if (raw[0] !== 0x04) return false;
      const key = createPublicKey({
        format: "jwk",
        key: {
          kty: "EC",
          crv: "P-256",
          x: encode(raw.subarray(1, 33)),
          y: encode(raw.subarray(33, 65))
        }
      });
      return verifySignature(
        "sha256",
        Buffer.from(byteArray(message, "message")),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(byteArray(signature, "signature", 64))
      );
    } catch {
      return false;
    }
  }

  #isScopedKeyId(keyId) {
    return typeof keyId === "string"
      && keyId.startsWith(this.#keyPrefix)
      && KEY_ID_PATTERN.test(keyId);
  }

  #assertScopedKeyId(keyId) {
    if (!this.#isScopedKeyId(keyId)) throw new Error("key_scope_mismatch");
  }

  #invoke(command, fields = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let child;

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };

      const timer = setTimeout(() => {
        try { child?.kill(); } catch { /* Process may already have exited. */ }
        finish(new Error("windows_cng_host_timeout"));
      }, this.#timeoutMs);
      timer.unref?.();

      try {
        child = this.#spawn(this.#hostExecutable, [], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch {
        finish(new Error("windows_cng_host_start_failed"));
        return;
      }

      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", chunk => {
        stdout += chunk;
        if (Buffer.byteLength(stdout, "utf8") > MAX_HOST_OUTPUT_BYTES) {
          try { child.kill(); } catch { /* Process may already have exited. */ }
          finish(new Error("windows_cng_host_output_too_large"));
        }
      });
      child.stderr?.on("data", chunk => {
        stderr += chunk;
        if (Buffer.byteLength(stderr, "utf8") > MAX_HOST_OUTPUT_BYTES) {
          stderr = stderr.slice(-4096);
        }
      });
      child.on("error", () => finish(new Error("windows_cng_host_start_failed")));
      child.on("close", code => {
        if (settled) return;
        let response;
        try { response = JSON.parse(stdout.trim()); }
        catch { finish(new Error(code === 0 ? "windows_cng_host_invalid_response" : "windows_cng_host_failed")); return; }
        if (code !== 0 || response?.ok !== true) {
          const safeError = typeof response?.error === "string" && /^[a-z0-9_]+$/.test(response.error)
            ? response.error
            : "windows_cng_host_failed";
          finish(new Error(safeError));
          return;
        }
        finish(null, response);
      });

      try {
        child.stdin.end(JSON.stringify({
          command,
          installationId: this.#installationId,
          ...fields
        }) + "\n");
      } catch {
        finish(new Error("windows_cng_host_write_failed"));
      }
    });
  }
}
