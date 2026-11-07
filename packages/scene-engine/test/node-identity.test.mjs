import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash, randomBytes } from "node:crypto";
import { EphemeralEd25519KeyStore, EphemeralP256KeyStore, NodeIdentityManager } from "../src/node-identity.mjs";

function fixture({ keyStore = new EphemeralEd25519KeyStore({ subtle: webcrypto.subtle, randomUUID: () => webcrypto.randomUUID() }) } = {}) {
  let now = 1_800_000_000_000;
  const values = { current: null };
  const metadataStore = {
    async get() { return values.current; },
    async compareAndSet(expectedRevision, next) {
      const currentRevision = values.current?.revision ?? null;
      if (currentRevision !== expectedRevision) return false;
      values.current = next;
      return true;
    }
  };
  const manager = new NodeIdentityManager({
    keyStore, metadataStore, clock: () => now, allowEphemeral: true,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async size => new Uint8Array(randomBytes(size))
  });
  return { manager, metadataStore, keyStore, advance(ms) { now += ms; } };
}

test("creates a scoped Ed25519 identity and exposes no private key material", async () => {
  const { manager } = fixture();
  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  assert.equal(identity.algorithm, "Ed25519");
  assert.match(identity.identityFingerprint, /^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/);
  assert.equal("privateKey" in identity, false);
  assert.equal((await manager.getPublicIdentity()).publicKey, identity.publicKey);
});

test("creates, signs and verifies an ECDSA P-256 identity with explicit algorithm metadata", async () => {
  const keyStore = new EphemeralP256KeyStore({ subtle: webcrypto.subtle, randomUUID: () => webcrypto.randomUUID() });
  const { manager } = fixture({ keyStore });
  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-02" });
  assert.equal(identity.algorithm, "ECDSA-P256-SHA256");
  assert.equal(Buffer.from(identity.publicKey, "base64url").length, 65);

  const challenge = await manager.createChallenge({ audience: "node:remote-02" });
  const proof = await manager.provePossession(challenge);
  assert.equal(proof.algorithm, identity.algorithm);
  assert.equal(Buffer.from(proof.signature, "base64url").length, 64);
  assert.equal(await manager.verifyProof({
    publicKey: identity.publicKey,
    challenge,
    signature: proof.signature,
    algorithm: identity.algorithm
  }), true);
  assert.equal(await manager.verifyProof({
    publicKey: identity.publicKey,
    challenge,
    signature: proof.signature,
    algorithm: "Ed25519"
  }), false);
  await assert.rejects(manager.provePossession(challenge), /challenge_replayed_or_already_consumed/);

  const rotated = await manager.rotate();
  assert.equal(rotated.algorithm, identity.algorithm);
  assert.notEqual(rotated.identityFingerprint, identity.identityFingerprint);
});

test("ECDSA P-256 test provider keeps generated private CryptoKeys non-extractable", async () => {
  let generatedPrivateKey;
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "generateKey") {
        return async (...args) => {
          const pair = await value.apply(target, args);
          generatedPrivateKey = pair.privateKey;
          return pair;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const keyStore = new EphemeralP256KeyStore({ subtle, randomUUID: () => webcrypto.randomUUID() });
  await keyStore.createKeyPair();
  assert.equal(generatedPrivateKey.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey("pkcs8", generatedPrivateKey), /not extractable/i);
});

test("rejects duplicate active identity and malformed scope", async () => {
  const { manager } = fixture();
  await assert.rejects(manager.create({ organizationId: "../other", nodeId: "node:desktop-01" }), /invalid_identity_scope/);
  await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  await assert.rejects(manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" }), /already_exists/);
});

test("proves possession and rejects tampered challenge or expired proof", async () => {
  const { manager, advance } = fixture();
  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  const challenge = await manager.createChallenge({ audience: "node:remote-02" });
  const proof = await manager.provePossession(challenge);
  assert.equal(await manager.verifyProof({ publicKey: identity.publicKey, challenge, signature: proof.signature }), true);
  await assert.rejects(manager.provePossession(challenge), /challenge_replayed_or_already_consumed/);
  assert.equal(await manager.verifyProof({ publicKey: identity.publicKey, challenge: { ...challenge, audience: "attacker-node" }, signature: proof.signature }), false);
  advance(31_000);
  await assert.rejects(manager.provePossession(challenge), /challenge_expired/);
  assert.equal(await manager.verifyProof({ publicKey: identity.publicKey, challenge, signature: proof.signature }), false);
});

test("rotation changes key and fingerprint while preserving node scope", async () => {
  const { manager } = fixture();
  const first = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  const second = await manager.rotate();
  assert.equal(second.organizationId, first.organizationId);
  assert.equal(second.nodeId, first.nodeId);
  assert.equal(second.generation, first.generation + 1);
  assert.notEqual(second.identityFingerprint, first.identityFingerprint);
});

test("revocation deletes the private key and makes identity unavailable", async () => {
  const { manager } = fixture();
  await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  assert.equal(await manager.revoke(), true);
  assert.equal(await manager.getPublicIdentity(), null);
  await assert.rejects(manager.provePossession(await manager.createChallenge({ audience: "remote-node" })), /unavailable/);
  assert.equal(await manager.revoke(), false);
});

test("rejects malformed cryptographic challenge entropy and proof encodings", async () => {
  const { manager, metadataStore, keyStore } = fixture();
  const weakEntropyManager = new NodeIdentityManager({
    keyStore, metadataStore, clock: () => 1_800_000_000_000, allowEphemeral: true,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async () => new Uint8Array(31)
  });
  await assert.rejects(weakEntropyManager.createChallenge({ audience: "remote-node" }), /random_nonce_must_be_32_bytes/);
  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  const challenge = await manager.createChallenge({ audience: "node:remote-02" });
  const proof = await manager.provePossession(challenge);
  assert.equal(await manager.verifyProof({ publicKey: identity.publicKey, challenge, signature: "AQ" }), false);
  assert.equal(await manager.verifyProof({ publicKey: "AQ", challenge, signature: proof.signature }), false);
  await assert.rejects(manager.provePossession({ ...challenge, expiresAt: Number.NaN }), /invalid_challenge_window/);
});


test("cleans up a newly generated key when the metadata compare-and-set loses a race", async () => {
  const { manager, metadataStore, keyStore } = fixture();
  let generatedKeyId;
  const createKeyPair = keyStore.createKeyPair.bind(keyStore);
  keyStore.createKeyPair = async () => {
    const pair = await createKeyPair();
    generatedKeyId = pair.keyId;
    return pair;
  };
  metadataStore.compareAndSet = async () => false;

  await assert.rejects(
    manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" }),
    /identity_metadata_conflict/
  );
  assert.equal(await keyStore.hasKey(generatedKeyId), false);
  assert.equal(await metadataStore.get(), null);
});

test("rotation commits the new identity before old-key cleanup and reconciles failures", async () => {
  const { manager, metadataStore, keyStore } = fixture();
  const first = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  const deleteKey = keyStore.deleteKey.bind(keyStore);
  keyStore.deleteKey = async keyId => keyId === first.keyId ? false : deleteKey(keyId);

  await assert.rejects(manager.rotate(), /identity_rotated_key_cleanup_pending/);
  const committed = await metadataStore.get();
  assert.notEqual(committed.keyId, first.keyId);
  assert.deepEqual([...committed.pendingKeyDeletionIds], [first.keyId]);
  assert.notEqual(await manager.getPublicIdentity(), null);
  assert.equal(await keyStore.hasKey(first.keyId), true);

  keyStore.deleteKey = deleteKey;
  const reconciled = await manager.reconcile();
  assert.equal(reconciled.status, "active");
  assert.deepEqual(reconciled.pendingKeyDeletionIds, []);
  assert.equal(await keyStore.hasKey(first.keyId), false);
  assert.deepEqual([...(await metadataStore.get()).pendingKeyDeletionIds], []);
});

test("revocation marks identity unusable before deletion and retains cleanup state on failure", async () => {
  const { manager, metadataStore, keyStore } = fixture();
  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  const deleteKey = keyStore.deleteKey.bind(keyStore);
  keyStore.deleteKey = async () => false;

  await assert.rejects(manager.revoke(), /identity_revoked_key_deletion_pending/);
  const tombstone = await metadataStore.get();
  assert.ok(tombstone.revokedAt);
  assert.equal(tombstone.keyDeletionPending, true);
  assert.equal(await manager.getPublicIdentity(), null);
  assert.equal(await keyStore.hasKey(identity.keyId), true);

  keyStore.deleteKey = deleteKey;
  const reconciled = await manager.reconcile();
  assert.equal(reconciled.status, "revoked");
  assert.equal((await metadataStore.get()).keyDeletionPending, false);
  assert.equal(await keyStore.hasKey(identity.keyId), false);
});

test("missing active key becomes unavailable and is never silently regenerated", async () => {
  const { manager, metadataStore, keyStore } = fixture();
  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  assert.equal(await keyStore.deleteKey(identity.keyId), true);

  const reconciled = await manager.reconcile();
  assert.equal(reconciled.status, "identity_unavailable");
  assert.equal((await metadataStore.get()).keyMissingAt > 0, true);
  assert.equal(await manager.getPublicIdentity(), null);
  await assert.rejects(
    manager.provePossession(await manager.createChallenge({ audience: "remote-node" })),
    /node_identity_unavailable/
  );
  await assert.rejects(
    manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" }),
    /node_identity_already_exists/
  );
});


test("preserves a key when metadata commit succeeded but its acknowledgement was lost", async () => {
  const { manager, metadataStore, keyStore } = fixture();
  const compareAndSet = metadataStore.compareAndSet.bind(metadataStore);
  metadataStore.compareAndSet = async (...args) => {
    await compareAndSet(...args);
    throw new Error("simulated_lost_acknowledgement");
  };

  const identity = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  assert.equal((await metadataStore.get()).keyId, identity.keyId);
  assert.equal(await keyStore.hasKey(identity.keyId), true);
  assert.equal((await manager.getPublicIdentity()).identityFingerprint, identity.identityFingerprint);
});


test("migrates legacy identity metadata without a revision during rotation", async () => {
  const { manager, metadataStore } = fixture();
  const first = await manager.create({ organizationId: "acme-office", nodeId: "node:desktop-01" });
  let legacy = { ...(await metadataStore.get()) };
  delete legacy.revision;
  metadataStore.get = async () => legacy;
  metadataStore.compareAndSet = async (expectedRevision, next) => {
    if ((legacy?.revision ?? 0) !== expectedRevision) return false;
    legacy = next;
    return true;
  };

  const rotated = await manager.rotate();
  assert.equal(rotated.generation, first.generation + 1);
  assert.equal(rotated.revision, 2);
  assert.equal(legacy.keyId, rotated.keyId);
});


test("reports ephemeral protection honestly and requires explicit test opt-in", () => {
  const keyStore = new EphemeralEd25519KeyStore({ subtle: webcrypto.subtle, randomUUID: () => webcrypto.randomUUID() });
  const metadataStore = {
    async get() { return null; },
    async compareAndSet() { return true; }
  };
  const dependencies = {
    keyStore,
    metadataStore,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async size => new Uint8Array(randomBytes(size))
  };

  assert.deepEqual(keyStore.getCapabilities(), {
    providerId: "ephemeral-ed25519",
    persistent: false,
    protectionLevel: "ephemeral",
    hardwareBacked: false,
    privateKeyNonExportable: false,
    algorithms: ["Ed25519"]
  });
  assert.throws(() => new NodeIdentityManager(dependencies), /ephemeral_keystore_not_allowed/);
  assert.doesNotThrow(() => new NodeIdentityManager({ ...dependencies, allowEphemeral: true }));
});


test("rejects a persistent provider that claims exportable private keys", () => {
  const { keyStore, metadataStore, manager } = fixture();
  const unsafeStore = Object.create(keyStore);
  unsafeStore.getCapabilities = () => ({
    providerId: "unsafe-persistent-test",
    persistent: true,
    protectionLevel: "os-protected",
    hardwareBacked: false,
    privateKeyNonExportable: false,
    algorithms: ["Ed25519"]
  });
  const dependencies = {
    keyStore: unsafeStore,
    metadataStore,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async size => new Uint8Array(randomBytes(size))
  };
  assert.ok(manager);
  assert.throws(() => new NodeIdentityManager(dependencies), /keystore_private_key_exportable/);
});
