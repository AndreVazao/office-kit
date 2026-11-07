import { InMemoryNodeIdentityChallengeStore } from "./node-identity-challenge-store.mjs";
const encoder = new TextEncoder();
const FINGERPRINT_BYTES = 32;
const IDENTITY_ALGORITHMS = Object.freeze({
  Ed25519: Object.freeze({ publicKeyBytes: 32, signatureBytes: 64 }),
  "ECDSA-P256-SHA256": Object.freeze({ publicKeyBytes: 65, signatureBytes: 64 })
});
const KEY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const NODE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const ORG_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function bytes(value, label, expectedLength) {
  if (!(value instanceof Uint8Array) || value.length === 0) throw new TypeError(`${label}_must_be_non_empty_bytes`);
  if (expectedLength !== undefined && value.length !== expectedLength) throw new TypeError(`${label}_must_be_${expectedLength}_bytes`);
  return value;
}
function hex(value) { return [...value].map(byte => byte.toString(16).padStart(2, "0")).join(":"); }
function base64url(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("invalid_public_key_encoding");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function canonicalChallenge(challenge) {
  if (!challenge || typeof challenge !== "object" || Array.isArray(challenge)) throw new TypeError("invalid_challenge");
  if (typeof challenge.nonce !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(challenge.nonce)) throw new TypeError("invalid_challenge_nonce");
  if (!Number.isSafeInteger(challenge.issuedAt) || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= challenge.issuedAt) throw new TypeError("invalid_challenge_window");
  if (challenge.expiresAt - challenge.issuedAt > 60_000) throw new TypeError("challenge_window_too_long");
  if (typeof challenge.audience !== "string" || challenge.audience.length < 3 || challenge.audience.length > 128) throw new TypeError("invalid_challenge_audience");
  return encoder.encode(JSON.stringify({ audience: challenge.audience, expiresAt: challenge.expiresAt, issuedAt: challenge.issuedAt, nonce: challenge.nonce }));
}

/**
 * Secure keystore boundary. Implementations must keep private key material
 * non-exportable and protect it with the host OS/browser secure storage.
 */
export class NodeKeyStoreProvider {
  async createKeyPair(_options) { throw new Error("keystore_create_not_implemented"); }
  async sign(_keyId, _message, _algorithm) { throw new Error("keystore_sign_not_implemented"); }
  async deleteKey(_keyId) { throw new Error("keystore_delete_not_implemented"); }
  async hasKey(_keyId) { throw new Error("keystore_has_key_not_implemented"); }
  getCapabilities() { throw new Error("keystore_capabilities_not_implemented"); }
  async verify(_publicKey, _message, _signature, _algorithm) { throw new Error("keystore_verify_not_implemented"); }
}

/** Atomic metadata boundary. expectedRevision=null means the record must not exist. */
export class NodeIdentityMetadataStore {
  async get() { throw new Error("identity_metadata_get_not_implemented"); }
  async compareAndSet(_expectedRevision, _next) { throw new Error("identity_metadata_compare_and_set_not_implemented"); }
}

/** In-memory reference provider for tests and ephemeral sessions only. */
export class EphemeralEd25519KeyStore extends NodeKeyStoreProvider {
  #subtle;
  #keys = new Map();
  #randomUUID;
  constructor({ subtle = globalThis.crypto?.subtle, randomUUID = () => globalThis.crypto.randomUUID() } = {}) {
    super();
    if (!subtle || typeof randomUUID !== "function") throw new Error("webcrypto_ed25519_unavailable");
    this.#subtle = subtle;
    this.#randomUUID = randomUUID;
  }
  async createKeyPair() {
    const pair = await this.#subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKey = new Uint8Array(await this.#subtle.exportKey("raw", pair.publicKey));
    const privateKey = await this.#subtle.exportKey("pkcs8", pair.privateKey);
    const keyId = this.#randomUUID();
    this.#keys.set(keyId, { privateKey: await this.#subtle.importKey("pkcs8", privateKey, { name: "Ed25519" }, false, ["sign"]), publicKey: pair.publicKey });
    return Object.freeze({ keyId, publicKey, algorithm: "Ed25519" });
  }
  async sign(keyId, message, algorithm = "Ed25519") {
    if (algorithm !== "Ed25519") throw new Error("keystore_algorithm_unsupported");
    const pair = this.#keys.get(keyId);
    if (!pair) throw new Error("private_key_not_found");
    return new Uint8Array(await this.#subtle.sign("Ed25519", pair.privateKey, bytes(message, "message")));
  }
  async deleteKey(keyId) { return this.#keys.delete(keyId); }
  async hasKey(keyId) { return this.#keys.has(keyId); }
  getCapabilities() {
    return Object.freeze({
      providerId: "ephemeral-ed25519",
      persistent: false,
      protectionLevel: "ephemeral",
      hardwareBacked: false,
      privateKeyNonExportable: false,
      algorithms: Object.freeze(["Ed25519"])
    });
  }
  async verify(publicKey, message, signature, algorithm = "Ed25519") {
    if (algorithm !== "Ed25519") return false;
    const key = await this.#subtle.importKey("raw", bytes(publicKey, "public_key", 32), { name: "Ed25519" }, false, ["verify"]);
    return this.#subtle.verify("Ed25519", key, bytes(signature, "signature", 64), bytes(message, "message"));
  }
}

/** Ephemeral ECDSA P-256 provider for algorithm-agility tests and demonstrations only. */
export class EphemeralP256KeyStore extends NodeKeyStoreProvider {
  #subtle;
  #keys = new Map();
  #randomUUID;

  constructor({ subtle = globalThis.crypto?.subtle, randomUUID = () => globalThis.crypto.randomUUID() } = {}) {
    super();
    if (!subtle || typeof randomUUID !== "function") throw new Error("webcrypto_ecdsa_p256_unavailable");
    this.#subtle = subtle;
    this.#randomUUID = randomUUID;
  }

  async createKeyPair({ algorithm = "ECDSA-P256-SHA256" } = {}) {
    if (algorithm !== "ECDSA-P256-SHA256") throw new Error("keystore_algorithm_unsupported");
    const pair = await this.#subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const publicKey = new Uint8Array(await this.#subtle.exportKey("raw", pair.publicKey));
    const keyId = this.#randomUUID();
    this.#keys.set(keyId, { privateKey: pair.privateKey, publicKey: pair.publicKey });
    return Object.freeze({ keyId, publicKey, algorithm });
  }

  async sign(keyId, message, algorithm = "ECDSA-P256-SHA256") {
    if (algorithm !== "ECDSA-P256-SHA256") throw new Error("keystore_algorithm_unsupported");
    const pair = this.#keys.get(keyId);
    if (!pair) throw new Error("private_key_not_found");
    return new Uint8Array(await this.#subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      bytes(message, "message")
    ));
  }

  async deleteKey(keyId) { return this.#keys.delete(keyId); }
  async hasKey(keyId) { return this.#keys.has(keyId); }

  getCapabilities() {
    return Object.freeze({
      providerId: "ephemeral-ecdsa-p256",
      persistent: false,
      protectionLevel: "ephemeral",
      hardwareBacked: false,
      privateKeyNonExportable: true,
      algorithms: Object.freeze(["ECDSA-P256-SHA256"])
    });
  }

  async verify(publicKey, message, signature, algorithm = "ECDSA-P256-SHA256") {
    if (algorithm !== "ECDSA-P256-SHA256") return false;
    const key = await this.#subtle.importKey(
      "raw",
      bytes(publicKey, "public_key", 65),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return this.#subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      bytes(signature, "signature", 64),
      bytes(message, "message")
    );
  }
}

function lifecycleError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function revisionOf(identity) {
  if (!identity) return null;
  if (identity.revision === undefined) return 0;
  if (!Number.isSafeInteger(identity.revision) || identity.revision < 0) {
    throw new TypeError("invalid_identity_metadata_revision");
  }
  return identity.revision;
}

/**
 * Manages one installation's algorithm-declared identity. Metadata changes use
 * revisioned compare-and-set so rotation/revocation cannot expose half-written identities.
 * The keystore retains private keys; no network or authorization I/O is performed.
 */
export class NodeIdentityManager {
  #keyStore;
  #metadataStore;
  #challengeStore;
  #digest;
  #randomBytes;
  #clock;
  #algorithms;
  #defaultAlgorithm;

  constructor({ keyStore, metadataStore, challengeStore, digest, randomBytes, clock = Date.now, allowEphemeral = false }) {
    if (!keyStore || typeof keyStore.createKeyPair !== "function"
      || typeof keyStore.sign !== "function" || typeof keyStore.deleteKey !== "function"
      || typeof keyStore.hasKey !== "function" || typeof keyStore.verify !== "function"
      || typeof keyStore.getCapabilities !== "function"
      || !metadataStore || typeof metadataStore.get !== "function"
      || typeof metadataStore.compareAndSet !== "function"
      || typeof digest !== "function" || typeof randomBytes !== "function") {
      throw new TypeError("identity_manager_dependencies_required");
    }
    const capabilities = keyStore.getCapabilities();
    const protectionLevels = new Set(["hardware", "os-protected", "browser-origin", "ephemeral"]);
    const algorithms = Array.isArray(capabilities?.algorithms) ? [...capabilities.algorithms] : [];
    const defaultAlgorithm = capabilities?.defaultAlgorithm ?? algorithms[0];
    if (!capabilities || typeof capabilities !== "object"
      || typeof capabilities.persistent !== "boolean"
      || !protectionLevels.has(capabilities.protectionLevel)
      || typeof capabilities.hardwareBacked !== "boolean"
      || typeof capabilities.privateKeyNonExportable !== "boolean"
      || algorithms.length === 0
      || new Set(algorithms).size !== algorithms.length
      || algorithms.some(algorithm => !Object.hasOwn(IDENTITY_ALGORITHMS, algorithm))
      || !algorithms.includes(defaultAlgorithm)
      || (capabilities.hardwareBacked && capabilities.protectionLevel !== "hardware")) {
      throw new TypeError("invalid_keystore_capabilities");
    }
    if (!capabilities.persistent && allowEphemeral !== true) {
      throw new Error("ephemeral_keystore_not_allowed");
    }
    if (capabilities.persistent && !capabilities.privateKeyNonExportable) {
      throw new Error("keystore_private_key_exportable");
    }
    const replayStore = challengeStore ?? (allowEphemeral === true ? new InMemoryNodeIdentityChallengeStore() : null);
    if (!replayStore || typeof replayStore.consume !== "function"
      || typeof replayStore.persistent !== "boolean") {
      throw new TypeError("identity_challenge_store_required");
    }
    if (capabilities.persistent && replayStore.persistent !== true) {
      throw new Error("persistent_identity_requires_durable_challenge_store");
    }
    if (capabilities.persistent && !capabilities.privateKeyNonExportable) {
      throw new Error("keystore_private_key_exportable");
    }
    this.#keyStore = keyStore;
    this.#algorithms = new Set(algorithms);
    this.#defaultAlgorithm = defaultAlgorithm;
    this.#metadataStore = metadataStore;
    this.#challengeStore = replayStore;
    this.#digest = digest;
    this.#randomBytes = randomBytes;
    this.#clock = clock;
  }

  async #deleteIfPresent(keyId) {
    if (!(await this.#keyStore.hasKey(keyId))) return true;
    const deleted = await this.#keyStore.deleteKey(keyId);
    return deleted === true || !(await this.#keyStore.hasKey(keyId));
  }

  async #prepareIdentity({ organizationId, nodeId, previous, pendingKeyDeletionIds = [] }) {
    const preferredAlgorithm = previous ? (previous.algorithm ?? "Ed25519") : this.#defaultAlgorithm;
    const pair = await this.#keyStore.createKeyPair({ algorithm: preferredAlgorithm });
    const keyId = pair?.keyId;
    try {
      if (!pair || typeof keyId !== "string" || !KEY_ID.test(keyId)) {
        throw new TypeError("invalid_keystore_key_id");
      }
      const algorithm = pair.algorithm ?? preferredAlgorithm;
      const algorithmShape = IDENTITY_ALGORITHMS[algorithm];
      if (!algorithmShape || !this.#algorithms.has(algorithm) || algorithm !== preferredAlgorithm) {
        throw new TypeError("identity_algorithm_not_supported_by_keystore");
      }
      const publicKey = bytes(pair.publicKey, "public_key", algorithmShape.publicKeyBytes);
      const fingerprintBytes = bytes(await this.#digest(publicKey), "fingerprint");
      if (fingerprintBytes.length !== FINGERPRINT_BYTES) {
        throw new Error("sha256_digest_must_return_32_bytes");
      }
      return Object.freeze({
        organizationId,
        nodeId,
        keyId,
        publicKey: base64url(publicKey),
        identityFingerprint: hex(fingerprintBytes),
        algorithm,
        createdAt: this.#clock(),
        generation: (previous?.generation ?? 0) + 1,
        revision: (revisionOf(previous) ?? 0) + 1,
        pendingKeyDeletionIds: Object.freeze([...new Set(pendingKeyDeletionIds)]),
        keyDeletionPending: false
      });
    } catch (error) {
      if (typeof keyId === "string") {
        try {
          if (!(await this.#deleteIfPresent(keyId))) {
            throw lifecycleError("identity_create_key_cleanup_pending");
          }
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "identity_create_key_cleanup_failed");
        }
      }
      throw error;
    }
  }

  async #commitPrepared(previous, next) {
    let committed = false;
    try {
      committed = await this.#metadataStore.compareAndSet(revisionOf(previous), next);
    } catch (error) {
      let observed;
      try {
        observed = await this.#metadataStore.get();
      } catch (readError) {
        throw new AggregateError([error, readError], "identity_metadata_commit_outcome_unknown");
      }
      if (observed?.keyId === next.keyId) return observed;
      try {
        if (!(await this.#deleteIfPresent(next.keyId))) {
          throw lifecycleError("identity_create_key_cleanup_pending");
        }
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "identity_metadata_commit_cleanup_failed");
      }
      throw error;
    }
    if (committed === true) return next;
    try {
      if (!(await this.#deleteIfPresent(next.keyId))) {
        throw lifecycleError("identity_create_key_cleanup_pending");
      }
    } catch (cleanupError) {
      throw new AggregateError([lifecycleError("identity_metadata_conflict"), cleanupError], "identity_metadata_conflict_cleanup_failed");
    }
    throw lifecycleError("identity_metadata_conflict");
  }

  async create({ organizationId, nodeId }) {
    if (!ORG_ID.test(organizationId ?? "") || !NODE_ID.test(nodeId ?? "")) {
      throw new TypeError("invalid_identity_scope");
    }
    const existing = await this.#metadataStore.get();
    if (existing && !existing.revokedAt) throw new Error("node_identity_already_exists");
    if (existing?.keyDeletionPending || existing?.pendingKeyDeletionIds?.length) {
      throw new Error("node_identity_cleanup_pending");
    }
    const next = await this.#prepareIdentity({ organizationId, nodeId, previous: existing });
    return this.#commitPrepared(existing, next);
  }

  async getPublicIdentity() {
    const identity = await this.#metadataStore.get();
    if (!identity || identity.revokedAt || identity.keyMissingAt) return null;
    return Object.freeze({
      organizationId: identity.organizationId,
      nodeId: identity.nodeId,
      publicKey: identity.publicKey,
      identityFingerprint: identity.identityFingerprint,
      algorithm: identity.algorithm ?? "Ed25519",
      createdAt: identity.createdAt,
      generation: identity.generation
    });
  }

  async createChallenge({ audience, ttlMs = 30_000 } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000) {
      throw new TypeError("invalid_challenge_ttl");
    }
    if (typeof audience !== "string" || audience.length < 3 || audience.length > 128) {
      throw new TypeError("invalid_challenge_audience");
    }
    const nonce = base64url(bytes(await this.#randomBytes(32), "random_nonce", 32));
    const issuedAt = this.#clock();
    return Object.freeze({ nonce, audience, issuedAt, expiresAt: issuedAt + ttlMs });
  }

  async provePossession(challenge) {
    const message = canonicalChallenge(challenge);
    const identity = await this.#metadataStore.get();
    if (!identity || identity.revokedAt || identity.keyMissingAt) {
      throw new Error("node_identity_unavailable");
    }
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || challenge.issuedAt > now || challenge.expiresAt <= now) {
      throw new Error("challenge_expired_or_not_yet_valid");
    }
    const algorithm = identity.algorithm ?? "Ed25519";
    const algorithmShape = IDENTITY_ALGORITHMS[algorithm];
    if (!algorithmShape || !this.#algorithms.has(algorithm)) {
      throw new Error("node_identity_algorithm_unsupported");
    }
    const consumed = await this.#challengeStore.consume({
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      now
    });
    if (consumed !== true) throw new Error("challenge_replayed_or_already_consumed");
    return Object.freeze({
      keyId: identity.keyId,
      identityFingerprint: identity.identityFingerprint,
      algorithm,
      signature: base64url(bytes(
        await this.#keyStore.sign(identity.keyId, message, algorithm),
        "signature",
        algorithmShape.signatureBytes
      ))
    });
  }

  async verifyProof({ publicKey, challenge, signature, algorithm = "Ed25519" }) {
    try {
      const message = canonicalChallenge(challenge);
      const now = this.#clock();
      const algorithmShape = IDENTITY_ALGORITHMS[algorithm];
      if (!Object.hasOwn(IDENTITY_ALGORITHMS, algorithm) || !algorithmShape
        || !Number.isSafeInteger(now) || challenge.issuedAt > now || challenge.expiresAt <= now) return false;
      return await this.#keyStore.verify(
        bytes(fromBase64url(publicKey), "public_key", algorithmShape.publicKeyBytes),
        message,
        bytes(fromBase64url(signature), "signature", algorithmShape.signatureBytes),
        algorithm
      );
    } catch {
      return false;
    }
  }

  async rotate() {
    const current = await this.#metadataStore.get();
    if (!current || current.revokedAt || current.keyMissingAt) {
      throw new Error("node_identity_unavailable");
    }
    if (current.keyDeletionPending || current.pendingKeyDeletionIds?.length) {
      throw new Error("node_identity_cleanup_pending");
    }

    const next = await this.#prepareIdentity({
      organizationId: current.organizationId,
      nodeId: current.nodeId,
      previous: current,
      pendingKeyDeletionIds: [current.keyId]
    });
    await this.#commitPrepared(current, next);

    let oldKeyDeleted = false;
    try {
      oldKeyDeleted = await this.#deleteIfPresent(current.keyId);
    } catch (error) {
      throw lifecycleError("identity_rotated_key_cleanup_pending", error);
    }
    if (!oldKeyDeleted) throw lifecycleError("identity_rotated_key_cleanup_pending");

    const settled = Object.freeze({
      ...next,
      revision: next.revision + 1,
      pendingKeyDeletionIds: Object.freeze([])
    });
    const saved = await this.#metadataStore.compareAndSet(next.revision, settled);
    if (saved !== true) throw lifecycleError("identity_rotated_cleanup_state_pending");
    return settled;
  }

  async revoke() {
    const current = await this.#metadataStore.get();
    if (!current || current.revokedAt) return false;

    const tombstone = Object.freeze({
      ...current,
      revokedAt: this.#clock(),
      keyDeletionPending: true,
      revision: (current.revision ?? 0) + 1
    });
    const marked = await this.#metadataStore.compareAndSet(revisionOf(current), tombstone);
    if (marked !== true) throw lifecycleError("identity_metadata_conflict");

    let deleted = false;
    try {
      deleted = await this.#deleteIfPresent(current.keyId);
    } catch (error) {
      throw lifecycleError("identity_revoked_key_deletion_pending", error);
    }
    if (!deleted) throw lifecycleError("identity_revoked_key_deletion_pending");

    const completed = Object.freeze({
      ...tombstone,
      keyDeletionPending: false,
      revision: tombstone.revision + 1
    });
    const saved = await this.#metadataStore.compareAndSet(tombstone.revision, completed);
    if (saved !== true) throw lifecycleError("identity_revoked_cleanup_state_pending");
    return true;
  }

  async reconcile() {
    const current = await this.#metadataStore.get();
    if (!current) return Object.freeze({ status: "empty" });

    let changed = false;
    let next = { ...current };
    const pending = [];
    for (const keyId of current.pendingKeyDeletionIds ?? []) {
      let deleted = false;
      try {
        deleted = await this.#deleteIfPresent(keyId);
      } catch {
        deleted = false;
      }
      if (!deleted) pending.push(keyId);
    }
    if (pending.length !== (current.pendingKeyDeletionIds ?? []).length) changed = true;
    next.pendingKeyDeletionIds = Object.freeze(pending);

    if (current.keyDeletionPending) {
      let deleted = false;
      try {
        deleted = await this.#deleteIfPresent(current.keyId);
      } catch {
        deleted = false;
      }
      if (deleted) {
        next.keyDeletionPending = false;
        changed = true;
      }
    }

    if (!current.revokedAt && !current.keyMissingAt) {
      const exists = await this.#keyStore.hasKey(current.keyId);
      if (!exists) {
        next.keyMissingAt = this.#clock();
        changed = true;
      }
    }

    if (changed) {
      next.revision = (current.revision ?? 0) + 1;
      const saved = await this.#metadataStore.compareAndSet(revisionOf(current), Object.freeze(next));
      if (saved !== true) throw lifecycleError("identity_metadata_conflict");
    }

    const cleanupPending = Boolean(next.keyDeletionPending || next.pendingKeyDeletionIds.length);
    const status = next.revokedAt
      ? (cleanupPending ? "revoked_cleanup_pending" : "revoked")
      : next.keyMissingAt
        ? "identity_unavailable"
        : cleanupPending
          ? "cleanup_pending"
          : "active";
    return Object.freeze({ status, pendingKeyDeletionIds: Object.freeze([...next.pendingKeyDeletionIds]) });
  }
}
