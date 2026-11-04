import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createProductProfile, productEditionCatalog } from "../packages/scene-engine/src/product-profile.mjs";

const edition = process.argv[2];
if (!Object.hasOwn(productEditionCatalog, edition)) {
  throw new Error("usage: node scripts/build-edition.mjs <universal|dgmat|vst>");
}

const descriptor = productEditionCatalog[edition];
const profile = createProductProfile({
  edition,
  installationId: "build-template",
  displayName: descriptor.channel === "public" ? "Office Kit Universal" : descriptor.channel === "personal" && edition === "dgmat" ? "Office Kit DGM-MAT" : "Office Kit VST"
});
const outputDir = resolve("dist", edition);
await mkdir(outputDir, { recursive: true });

const manifest = {
  schemaVersion: 1,
  product: "Office Kit",
  edition,
  channel: profile.channel,
  backendIndependentCore: true,
  adapterAllowlist: profile.adapterAllowlist,
  defaults: {
    autoConnect: false,
    adapterMode: "read-only",
    telemetry: false,
    crossInstallationSync: false,
    shareDataByDefault: false
  },
  installation: {
    installationId: null,
    storageNamespace: null,
    provisionOnFirstRun: true
  },
  build: {
    artifactType: "source-package",
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? "local"
  },
  limitations: [
    "This is a source distribution, not an OS installer.",
    "Personal backend adapters must be separately implemented and verified before live connection."
  ]
};

await writeFile(resolve(outputDir, "edition-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const pack = spawnSync("npm", ["pack", "--pack-destination", outputDir], { stdio: "inherit", shell: process.platform === "win32" });
if (pack.error) throw pack.error;
if (pack.status !== 0) process.exit(pack.status ?? 1);
console.log(`Built ${edition} source package in ${outputDir}`);
