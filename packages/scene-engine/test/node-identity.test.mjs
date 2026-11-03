import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash, randomBytes } from "node:crypto";
import { EphemeralEd25519KeyStore, NodeIdentityManager } from "../src/node-identity.mjs";

function fixture() {
  let now = 1_800_000_000_000;
  const values = { current: null };
  const metadataStore = { async get() { return values.current; }, async set(value) { values.current = value; } };
  const keyStore = new EphemeralEd25519KeyStore({ subtle: webcrypto.subtle, randomUUID: () => webcrypto.randomUUID() });
  const manager = new NodeIdentityManager({
    keyStore, metadataStore, clock: () => now,
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
