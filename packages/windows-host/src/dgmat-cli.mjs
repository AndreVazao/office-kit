import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createWindowsDgmMatHost } from "../../scene-engine/src/dgmat-windows-host.mjs";
import { resolveEditionHostOptions, runEditionCli } from "./edition-cli.mjs";

export function runDgmMatCli(options = {}) {
  const {
    createHost = configuration => createWindowsDgmMatHost(configuration),
    hostOptions = resolveEditionHostOptions("dgmat", options.env ?? process.env),
    ...runtimeOptions
  } = options;
  return runEditionCli({ edition: "dgmat", createHost, hostOptions, ...runtimeOptions });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDgmMatCli().then(code => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write(JSON.stringify({ ok: false, error: "launcher_failed" }) + "\n");
    process.exitCode = 1;
  });
}
