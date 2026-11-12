import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProductProfile, productEditionCatalog } from "../packages/scene-engine/src/product-profile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_RANGE = ">=22.5.0";

export const EDITION_FILE_ALLOWLISTS = Object.freeze({
  universal: Object.freeze([
    "packages/core/src/index.mjs",
    "packages/core/src/license-activation-registry.mjs",
    "packages/core/src/licensing.mjs",
    "packages/core/src/sqlite-license-activation-store.mjs",
    "packages/scene-engine/src/adapter-catalog.mjs",
    "packages/scene-engine/src/adapter-contract.mjs",
    "packages/scene-engine/src/adapter-gateway.mjs",
    "packages/scene-engine/src/diorama.mjs",
    "packages/scene-engine/src/federation-contract.mjs",
    "packages/scene-engine/src/generic-demo-adapter.mjs",
    "packages/scene-engine/src/index.mjs",
    "packages/scene-engine/src/node-identity-challenge-store.mjs",
    "packages/scene-engine/src/node-identity.mjs",
    "packages/scene-engine/src/office-health.mjs",
    "packages/scene-engine/src/office-state-manager.mjs",
    "packages/scene-engine/src/product-profile.mjs",
    "packages/scene-engine/src/quality.mjs",
    "packages/scene-engine/src/resource-policy.mjs",
    "packages/scene-engine/src/runtime-session.mjs",
    "packages/scene-engine/src/runtime-simulator.mjs",
    "packages/scene-engine/src/runtime-state.mjs",
    "packages/scene-engine/src/social-simulation.mjs",
    "packages/scene-engine/src/sqlite-node-identity-metadata-store.mjs",
    "packages/scene-engine/src/sqlite-office-incident-store.mjs",
    "packages/scene-engine/src/windows-cng-p256-keystore.mjs",
    "packages/scene-engine/src/windows-node-identity-runtime.mjs",
    "packages/scene-engine/src/windows.mjs",
    "packages/windows-host/src/cli.mjs",
    "packages/windows-host/src/hardware-capabilities.mjs",
    "packages/windows-host/src/index.mjs",
    "packages/windows-host/src/secret-vault.mjs",
    "LICENSE"
  ]),
  dgmat: Object.freeze([
    "packages/core/src/index.mjs",
    "packages/core/src/license-activation-registry.mjs",
    "packages/core/src/licensing.mjs",
    "packages/core/src/sqlite-license-activation-store.mjs",
    "packages/scene-engine/src/adapter-catalog.mjs",
    "packages/scene-engine/src/adapter-contract.mjs",
    "packages/scene-engine/src/adapter-gateway.mjs",
    "packages/scene-engine/src/dgmat-local-session-provider.mjs",
    "packages/scene-engine/src/dgmat-readonly-adapter.mjs",
    "packages/scene-engine/src/dgmat.mjs",
    "packages/scene-engine/src/dgmat-windows-host.mjs",
    "packages/scene-engine/src/diorama.mjs",
    "packages/scene-engine/src/federation-contract.mjs",
    "packages/scene-engine/src/generic-demo-adapter.mjs",
    "packages/scene-engine/src/index.mjs",
    "packages/scene-engine/src/node-identity-challenge-store.mjs",
    "packages/scene-engine/src/node-identity.mjs",
    "packages/scene-engine/src/office-health.mjs",
    "packages/scene-engine/src/office-state-manager.mjs",
    "packages/scene-engine/src/product-profile.mjs",
    "packages/scene-engine/src/quality.mjs",
    "packages/scene-engine/src/resource-policy.mjs",
    "packages/scene-engine/src/runtime-session.mjs",
    "packages/scene-engine/src/runtime-simulator.mjs",
    "packages/scene-engine/src/runtime-state.mjs",
    "packages/scene-engine/src/social-simulation.mjs",
    "packages/scene-engine/src/sqlite-node-identity-metadata-store.mjs",
    "packages/scene-engine/src/sqlite-office-incident-store.mjs",
    "packages/scene-engine/src/windows-cng-p256-keystore.mjs",
    "packages/scene-engine/src/windows-node-identity-runtime.mjs",
    "packages/scene-engine/src/windows.mjs",
    "packages/windows-host/src/cli.mjs",
    "packages/windows-host/src/hardware-capabilities.mjs",
    "packages/windows-host/src/index.mjs",
    "packages/windows-host/src/secret-vault.mjs",
    "LICENSE"
  ]),
  vst: Object.freeze([
    "packages/core/src/index.mjs",
    "packages/core/src/license-activation-registry.mjs",
    "packages/core/src/licensing.mjs",
    "packages/core/src/sqlite-license-activation-store.mjs",
    "packages/scene-engine/src/adapter-catalog.mjs",
    "packages/scene-engine/src/adapter-contract.mjs",
    "packages/scene-engine/src/adapter-gateway.mjs",
    "packages/scene-engine/src/diorama.mjs",
    "packages/scene-engine/src/federation-contract.mjs",
    "packages/scene-engine/src/generic-demo-adapter.mjs",
    "packages/scene-engine/src/index.mjs",
    "packages/scene-engine/src/node-identity-challenge-store.mjs",
    "packages/scene-engine/src/node-identity.mjs",
    "packages/scene-engine/src/office-health.mjs",
    "packages/scene-engine/src/office-state-manager.mjs",
    "packages/scene-engine/src/product-profile.mjs",
    "packages/scene-engine/src/quality.mjs",
    "packages/scene-engine/src/resource-policy.mjs",
    "packages/scene-engine/src/runtime-session.mjs",
    "packages/scene-engine/src/runtime-simulator.mjs",
    "packages/scene-engine/src/runtime-state.mjs",
    "packages/scene-engine/src/social-simulation.mjs",
    "packages/scene-engine/src/vst-readonly-adapter.mjs",
    "packages/scene-engine/src/vst.mjs",
    "packages/scene-engine/src/vst-windows-host.mjs",
    "packages/scene-engine/src/sqlite-node-identity-metadata-store.mjs",
    "packages/scene-engine/src/sqlite-office-incident-store.mjs",
    "packages/scene-engine/src/windows-cng-p256-keystore.mjs",
    "packages/scene-engine/src/windows-node-identity-runtime.mjs",
    "packages/scene-engine/src/windows.mjs",
    "packages/windows-host/src/cli.mjs",
    "packages/windows-host/src/hardware-capabilities.mjs",
    "packages/windows-host/src/index.mjs",
    "packages/windows-host/src/secret-vault.mjs",
    "LICENSE"
  ])
});

const EDITION_NAMES = Object.freeze({
  universal: "Office Kit Universal",
  dgmat: "Office Kit DGM-MAT",
  vst: "Office Kit VST"
});

export function getEditionFileAllowlist(edition) {
  if (!Object.hasOwn(EDITION_FILE_ALLOWLISTS, edition)) throw new Error("unsupported_edition");
  return [...EDITION_FILE_ALLOWLISTS[edition]];
}

function packageExports(edition) {
  const exports = {
    ".": "./packages/scene-engine/src/index.mjs",
    "./core": "./packages/core/src/index.mjs",
    "./scene-engine": "./packages/scene-engine/src/index.mjs",
    "./windows-host": "./packages/windows-host/src/index.mjs"
  };
  if (edition === "dgmat") {
    exports["./scene-engine/dgmat"] = "./packages/scene-engine/src/dgmat.mjs";
    exports["./windows-host/dgmat"] = "./packages/scene-engine/src/dgmat-windows-host.mjs";
  }
  if (edition === "vst") {
    exports["./scene-engine/vst"] = "./packages/scene-engine/src/vst.mjs";
    exports["./windows-host/vst"] = "./packages/scene-engine/src/vst-windows-host.mjs";
  }
  return exports;
}

export async function buildEditionPackage(edition, { outputDirectory = resolve(ROOT, "dist") } = {}) {
  const files = getEditionFileAllowlist(edition);
  const profile = createProductProfile({
    edition,
    installationId: "build-template",
    displayName: EDITION_NAMES[edition]
  });
  const rootPackage = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const output = join(resolve(outputDirectory), edition);
  const staging = await mkdtemp(join(tmpdir(), "office-kit-edition-"));
  const packageRoot = join(staging, "package");
  const hasDgmat = edition === "dgmat";
  const hasVst = edition === "vst";
  const adapterStatus = hasDgmat ? "included" : hasVst ? "read-only-preview" : "none";

  try {
    for (const relative of files) {
      const destination = join(packageRoot, relative);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(ROOT, relative), destination);
    }
    await mkdir(output, { recursive: true });

    const manifest = {
      schemaVersion: 2,
      product: "Office Kit Digital",
      edition,
      channel: profile.channel,
      displayName: EDITION_NAMES[edition],
      adapterAllowlist: profile.adapterAllowlist,
      adapterStatus,
      backendIndependentCore: true,
      nodeRuntime: { minimumVersion: "22.5.0", range: NODE_RANGE, sqliteApi: "node:sqlite", stability: "experimental_on_node_22" },
      defaults: { autoConnect: false, adapterMode: "read-only", telemetry: false, crossInstallationSync: false, shareDataByDefault: false },
      installation: { installationId: null, storageNamespace: null, provisionOnFirstRun: true },
      packageContents: {
        genericCore: true,
        dgmMatAdapter: hasDgmat,
        vstAdapter: hasVst,
        sourceFiles: files.filter(file => file !== "LICENSE")
      },
      build: { artifactType: "isolated-source-package", generatedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? "local" },
      limitations: [
        "This is an edition-isolated source package, not an OS installer.",
        "Packages start disconnected and read-only; backend activation requires explicit owner authorization.",
        ...(hasVst ? ["The VST adapter is read-only preview; live backend and physical-PC validation remain pending."] : []),
        "The Windows host requires Node.js 22.5 or later because it uses node:sqlite."
      ]
    };

    const packageJson = {
      name: "@andre-vazao/office-kit-" + edition,
      version: rootPackage.version,
      description: EDITION_NAMES[edition] + " — isolated backend-independent virtual office runtime",
      type: "module",
      license: "MIT",
      engines: { node: NODE_RANGE },
      files: ["packages/core/src/**", "packages/scene-engine/src/**", "packages/windows-host/src/**", "edition-manifest.json", "README.md", "LICENSE"],
      exports: packageExports(edition)
    };

    await writeFile(join(packageRoot, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
    await writeFile(join(packageRoot, "edition-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(join(packageRoot, "README.md"), [
      "# " + EDITION_NAMES[edition],
      "",
      "Edition-isolated Office Kit Digital source package.",
      "",
      "- Node.js: " + NODE_RANGE,
      "- Backend auto-connect: disabled",
      "- Initial adapter mode: read-only",
      "- Adapter status: " + adapterStatus,
      ...(hasVst ? ["- VST adapter: read-only preview; live backend validation pending"] : []),
      "",
      "See edition-manifest.json for the exact package contents."
    ].join("\n") + "\n");

    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const packed = spawnSync(command, ["pack", packageRoot, "--pack-destination", output, "--json"], {
      encoding: "utf8", windowsHide: true, shell: process.platform === "win32", maxBuffer: 4 * 1024 * 1024
    });
    if (packed.error) throw packed.error;
    if (packed.status !== 0) throw new Error("npm_pack_failed: " + (packed.stderr || packed.stdout || packed.status));
    const result = JSON.parse(packed.stdout.trim())[0];
    const manifestPath = join(output, "edition-manifest.json");
    await cp(join(packageRoot, "edition-manifest.json"), manifestPath);
    return { edition, packageName: packageJson.name, tarball: join(output, result.filename), manifest: manifestPath, sourceFiles: files };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function buildAllEditions(options = {}) {
  const results = [];
  for (const edition of Object.keys(EDITION_FILE_ALLOWLISTS)) results.push(await buildEditionPackage(edition, options));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const edition = process.argv[2];
  const outputArg = process.argv.slice(3).find(value => value.startsWith("--output-dir="));
  const result = await buildEditionPackage(edition, {
    outputDirectory: outputArg ? resolve(outputArg.slice("--output-dir=".length)) : resolve(ROOT, "dist")
  });
  console.log("Built " + result.packageName + " -> " + result.tarball);
}
