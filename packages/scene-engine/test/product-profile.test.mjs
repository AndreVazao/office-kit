import test from "node:test";
import assert from "node:assert/strict";
import { createProductProfile, assertProfileIsolation, productEditionCatalog } from "../src/product-profile.mjs";

test("creates backend-neutral public edition with no adapter dependency", () => {
  const profile = createProductProfile({ edition: "universal", installationId: "customer-001", displayName: "Office Kit" });
  assert.equal(profile.channel, "public");
  assert.deepEqual(profile.adapterAllowlist, []);
  const extended = createProductProfile({ edition: "universal", installationId: "customer-002", displayName: "Office Kit", adapterIds: ["any-compatible-backend", "another-adapter"] });
  assert.deepEqual(extended.adapterAllowlist, ["any-compatible-backend", "another-adapter"]);
  assert.equal(profile.backend.autoConnect, false);
  assert.equal(profile.privacy.telemetry, false);
});

test("creates isolated personal DGM-MAT and VST editions", () => {
  const dgmat = createProductProfile({ edition: "dgmat", installationId: "andre-dgmat-pc", displayName: "DGM-MAT" });
  const vst = createProductProfile({ edition: "vst", installationId: "andre-vst-pc", displayName: "VST" });
  assert.deepEqual(dgmat.adapterAllowlist, ["dgm-mat"]);
  assert.deepEqual(vst.adapterAllowlist, ["vazao-sovereign-trader"]);
  assert.notEqual(dgmat.storageNamespace, vst.storageNamespace);
  assert.equal(assertProfileIsolation([dgmat, vst]), true);
});

test("rejects personal adapter cross-injection and implicit auto-connect", () => {
  assert.throws(() => createProductProfile({ edition: "vst", installationId: "x", displayName: "VST", adapterIds: ["dgm-mat"] }), /invalid_product_profile/);
  assert.throws(() => createProductProfile({ edition: "dgmat", installationId: "x", displayName: "DGM-MAT", adapterIds: ["vazao-sovereign-trader"] }), /invalid_product_profile/);
  assert.throws(() => createProductProfile({ edition: "dgmat", installationId: "x", displayName: "DGM-MAT", backend: { autoConnect: true } }), /invalid_product_profile/);
});

test("rejects duplicate storage namespaces", () => {
  const a = createProductProfile({ edition: "vst", installationId: "same", displayName: "VST" });
  const b = createProductProfile({ edition: "vst", installationId: "same", displayName: "VST second" });
  assert.throws(() => assertProfileIsolation([a, b]), /duplicate_installation_storage_namespace/);
});

test("publishes three distinct edition descriptors", () => {
  assert.deepEqual(Object.keys(productEditionCatalog), ["universal", "dgmat", "vst"]);
});
