import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildEditionPackage } from "./build-edition.mjs";

function tarEntries(gzipPath, bytes) {
  const archive = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0/g, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    entries.push(prefix ? prefix + "/" + name : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(entries.length > 0, "npm pack archive should contain files: " + gzipPath);
  return entries;
}

async function build(edition) {
  const outputDirectory = await mkdtemp(join(tmpdir(), "office-kit-edition-test-"));
  try {
    const result = await buildEditionPackage(edition, { outputDirectory });
    const archive = await readFile(result.tarball);
    const entries = tarEntries(result.tarball, archive);
    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    return { result, entries, manifest };
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

test("Universal tarball contains generic modules and excludes DGM-MAT/VST source", async () => {
  const { entries, manifest } = await build("universal");
  const names = entries.join("\n");
  assert.ok(names.includes("package/packages/scene-engine/src/index.mjs"));
  assert.ok(names.includes("package/packages/windows-host/src/secret-vault.mjs"));
  assert.ok(!names.includes("dgmat-windows-host.mjs"));
  assert.ok(!names.includes("dgmat-readonly-adapter.mjs"));
  assert.ok(!names.includes("dgmat-local-session-provider.mjs"));
  assert.ok(!names.includes("dgmat.mjs"));
  assert.ok(!names.toLowerCase().includes("/vst/"));
  assert.ok(!names.includes("vst-readonly-adapter.mjs"));
  assert.ok(!names.includes("vst-windows-host.mjs"));
  assert.deepEqual(manifest.adapterAllowlist, []);
  assert.equal(manifest.packageContents.dgmMatAdapter, false);
  assert.equal(manifest.packageContents.vstAdapter, false);
});

test("DGM-MAT tarball includes its adapter/session/Windows host entrypoints and no VST source", async () => {
  const { entries, manifest } = await build("dgmat");
  const names = entries.join("\n");
  assert.ok(names.includes("package/packages/scene-engine/src/dgmat-readonly-adapter.mjs"));
  assert.ok(names.includes("package/packages/scene-engine/src/dgmat-local-session-provider.mjs"));
  assert.ok(names.includes("package/packages/scene-engine/src/dgmat.mjs"));
  assert.ok(names.includes("package/packages/scene-engine/src/dgmat-windows-host.mjs"));
  assert.ok(names.includes("package/packages/windows-host/src/secret-vault.mjs"));
  assert.ok(!names.toLowerCase().includes("/vst/"));
  assert.ok(!names.includes("vst-readonly-adapter.mjs"));
  assert.ok(!names.includes("vst-windows-host.mjs"));
  assert.deepEqual(manifest.adapterAllowlist, ["dgm-mat"]);
  assert.equal(manifest.packageContents.dgmMatAdapter, true);
  assert.equal(manifest.packageContents.vstAdapter, false);
});

test("VST tarball includes only its read-only adapter and excludes DGM-MAT source", async () => {
  const { entries, manifest } = await build("vst");
  const names = entries.join("\n");
  assert.ok(names.includes("package/packages/windows-host/src/secret-vault.mjs"));
  assert.ok(names.includes("package/packages/scene-engine/src/vst-readonly-adapter.mjs"));
  assert.ok(names.includes("package/packages/scene-engine/src/vst.mjs"));
  assert.ok(names.includes("package/packages/scene-engine/src/vst-windows-host.mjs"));
  assert.ok(!names.includes("dgmat-windows-host.mjs"));
  assert.ok(!names.includes("dgmat-readonly-adapter.mjs"));
  assert.ok(!names.includes("dgmat-local-session-provider.mjs"));
  assert.ok(!names.includes("dgmat.mjs"));
  assert.deepEqual(manifest.adapterAllowlist, ["vazao-sovereign-trader"]);
  assert.equal(manifest.adapterStatus, "read-only-preview");
  assert.equal(manifest.packageContents.dgmMatAdapter, false);
  assert.equal(manifest.packageContents.vstAdapter, true);
  assert.ok(manifest.limitations.some(value => value.includes("VST adapter is read-only preview")));
});

test("every edition tarball declares the Node 22.5 runtime floor", async () => {
  for (const edition of ["universal", "dgmat", "vst"]) {
    const { entries, manifest } = await build(edition);
    assert.ok(entries.includes("package/package.json"));
    assert.equal(manifest.nodeRuntime.minimumVersion, "22.5.0");
    assert.equal(manifest.nodeRuntime.range, ">=22.5.0");
  }
});
