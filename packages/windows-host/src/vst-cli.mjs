import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createWindowsVstHost } from "../../scene-engine/src/vst-windows-host.mjs";
import { resolveEditionHostOptions, runEditionCli } from "./edition-cli.mjs";

export function runVstCli(options = {}) {
  const {
    createHost = configuration => createWindowsVstHost(configuration),
    hostOptions = resolveEditionHostOptions("vst", options.env ?? process.env),
    ...runtimeOptions
  } = options;
  return runEditionCli({ edition: "vst", createHost, hostOptions, ...runtimeOptions });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runVstCli().then(code => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write(JSON.stringify({ ok: false, error: "launcher_failed" }) + "\n");
    process.exitCode = 1;
  });
}
