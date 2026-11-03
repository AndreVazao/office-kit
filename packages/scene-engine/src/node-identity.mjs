const encoder = new TextEncoder();
const FINGERPRINT_BYTES = 32;
const KEY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const NODE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const ORG_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function bytes(value, label) {
  if (!(value instanceof Uint8Array) || value.length === 0) throw new TypeError(`${label}_must_be_non_empty_bytes`);
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
  async createKeyPair() { throw new Error("keystore_create_not_implemented"); }
  async sign(_keyId, _message) { throw new Error("keystore_sign_not_implemented"); }
  async deleteKey(_keyId) { throw new Error("keystore_delete_not_implemented"); }
  async verify(_publicKey, _message, _signature) { throw new Error("keystore_verify_not_implemented"); }
}

/** In-memory reference provider for tests and ephemeral sessions only. */
export class EphemeralEd25519KeyStore extends NodeKeyStoreProvider {
  #subtle;
  #keys = new Map();
  #randomUUID;
  constructor({ subtle = globalThis.crypto?.subtle, randomUUID = globalThis.crypto?.randomUUID } = {}) {
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
    return Object.freeze({ keyId, publicKey });
  }
  async sign(keyId, message) {
    const pair = this.#keys.get(keyId);
    if (!pair) throw new Error("private_key_not_found");
    return new Uint8Array(await this.#subtle.sign("Ed25519", pair.privateKey, bytes(message, "message")));
  }
  async deleteKey(keyId) { return this.#keys.delete(keyId); }
  async verify(publicKey, message, signature) {
    const key = await this.#subtle.importKey("raw", bytes(publicKey, "public_key"), { name: "Ed25519" }, false, ["verify"]);
    return this.#subtle.verify("Ed25519", key, bytes(signature, "signature"), bytes(message, "message"));
  }
}

/**
 * Manages one installation's Ed25519 identity. Metadata persistence is injected;
 * the keystore retains private keys. No network, discovery, or authorization I/O.
 */
export class NodeIdentityManager {
  #keyStore;
  #metadataStore;
  #digest;
  #randomBytes;
  #clock;
  constructor({ keyStore, metadataStore, digest, randomBytes, clock = Date.now }) {
    if (!keyStore || !metadataStore || typeof digest !== "function" || typeof randomBytes !== "function") {
      throw new TypeError("identity_manager_dependencies_required");
    }
    this.#keyStore = keyStore;
    this.#metadataStore = metadataStore;
    this.#digest = digest;
    this.#randomBytes = randomBytes;
    this.#clock = clock;
  }
  async create({ organizationId, nodeId }) {
    if (!ORG_ID.test(organizationId ?? "") || !NODE_ID.test(nodeId ?? "")) throw new TypeError("invalid_identity_scope");
    const existing = await this.#metadataStore.get();
    if (existing && !existing.revokedAt) throw new Error("node_identity_already_exists");
    const pair = await this.#keyStore.createKeyPair();
    const publicKey = bytes(pair.publicKey, "public_key");
    const fingerprintBytes = bytes(await this.#digest(publicKey), "fingerprint");
    if (fingerprintBytes.length !== FINGERPRINT_BYTES) {
      await this.#keyStore.deleteKey(pair.keyId);
      throw new Error("sha256_digest_must_return_32_bytes");
    }
    const identity = Object.freeze({
      organizationId, nodeId, keyId: pair.keyId,
      publicKey: base64url(publicKey), identityFingerprint: hex(fingerprintBytes),
      algorithm: "Ed25519", createdAt: this.#clock(), generation: (existing?.generation ?? 0) + 1
    });
    await this.#metadataStore.set(identity);
    return identity;
  }
  async getPublicIdentity() {
    const identity = await this.#metadataStore.get();
    if (!identity || identity.revokedAt) return null;
    return Object.freeze({ organizationId: identity.organizationId, nodeId: identity.nodeId, publicKey: identity.publicKey, identityFingerprint: identity.identityFingerprint, algorithm: identity.algorithm, createdAt: identity.createdAt, generation: identity.generation });
  }
  async createChallenge({ audience, ttlMs = 30_000 } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000) throw new TypeError("invalid_challenge_ttl");
    if (typeof audience !== "string" || audience.length < 3 || audience.length > 128) throw new TypeError("invalid_challenge_audience");
    const nonce = base64url(bytes(await this.#randomBytes(32), "random_nonce"));
    const issuedAt = this.#clock();
    return Object.freeze({ nonce, audience, issuedAt, expiresAt: issuedAt + ttlMs });
  }
  async provePossession(challenge) {
    const identity = await this.#metadataStore.get();
    if (!identity || identity.revokedAt) throw new Error("node_identity_unavailable");
    const now = this.#clock();
    if (challenge?.issuedAt > now || challenge?.expiresAt <= now) throw new Error("challenge_expired_or_not_yet_valid");
    return Object.freeze({
      keyId: identity.keyId,
      identityFingerprint: identity.identityFingerprint,
      signature: base64url(await this.#keyStore.sign(identity.keyId, canonicalChallenge(challenge)))
    });
  }
  async verifyProof({ publicKey, challenge, signature }) {
    if (challenge?.issuedAt > this.#clock() || challenge?.expiresAt <= this.#clock()) return false;
    const verifier = this.#keyStore.verify;
    if (typeof verifier !== "function") throw new Error("keystore_verification_not_supported");
    try { return await verifier.call(this.#keyStore, fromBase64url(publicKey), canonicalChallenge(challenge), fromBase64url(signature)); }
    catch { return false; }
  }
  async rotate() {
    const current = await this.#metadataStore.get();
    if (!current || current.revokedAt) throw new Error("node_identity_unavailable");
    await this.#metadataStore.set(Object.freeze({ ...current, revokedAt: this.#clock() }));
    try {
      const next = await this.create({ organizationId: current.organizationId, nodeId: current.nodeId });
      await this.#keyStore.deleteKey(current.keyId);
      return next;
    } catch (error) {
      await this.#metadataStore.set(current);
      throw error;
    }
  }
  async revoke() {
    const current = await this.#metadataStore.get();
    if (!current || current.revokedAt) return false;
    await this.#keyStore.deleteKey(current.keyId);
    await this.#metadataStore.set(Object.freeze({ ...current, revokedAt: this.#clock() }));
    return true;
  }
}
