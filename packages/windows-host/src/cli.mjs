import { createWindowsHost } from "./index.mjs";

function argument(name) {
  const prefix = "--" + name + "=";
  const value = process.argv.slice(3).find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

async function main() {
  const command = process.argv[2] ?? "health";
  const host = createWindowsHost();
  try {
    if (command === "health") {
      console.log(JSON.stringify(await host.health(), null, 2));
      return;
    }
    if (command === "create-identity") {
      const organizationId = argument("organization-id");
      const nodeId = argument("node-id");
      if (!organizationId || !nodeId) throw new Error("organization_and_node_ids_required");
      const identity = await host.manager.create({ organizationId, nodeId });
      console.log(JSON.stringify({
        status: "created",
        generation: identity.generation,
        algorithm: identity.algorithm,
        identityFingerprint: identity.identityFingerprint
      }, null, 2));
      return;
    }
    if (command === "rotate-identity") {
      const identity = await host.manager.rotate();
      console.log(JSON.stringify({
        status: "rotated",
        generation: identity.generation,
        algorithm: identity.algorithm,
        identityFingerprint: identity.identityFingerprint
      }, null, 2));
      return;
    }
    if (command === "revoke-identity") {
      const revoked = await host.manager.revoke();
      console.log(JSON.stringify({ status: revoked ? "revoked" : "unchanged" }, null, 2));
      return;
    }
    throw new Error("unsupported_command");
  } finally {
    await host.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ status: "error", code: error?.message ?? "windows_host_failed" }));
  process.exitCode = 1;
});
