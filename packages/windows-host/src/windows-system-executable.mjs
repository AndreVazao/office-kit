import { win32 } from "node:path";

const ALLOWED_EXECUTABLES = new Set(["powershell.exe", "whoami.exe", "icacls.exe"]);

function normalized(value) {
  return win32.normalize(value).replace(/\\+$/, "").toLowerCase();
}

export function resolveWindowsSystemRoot({
  env = process.env,
  platform = process.platform
} = {}) {
  const systemRoot = typeof env.SystemRoot === "string" ? env.SystemRoot.trim() : "";
  const windowsDirectory = typeof env.WINDIR === "string" ? env.WINDIR.trim() : "";
  let selected = systemRoot || windowsDirectory;

  // Non-Windows unit tests may model a Windows host without a Windows environment.
  // Real Windows execution never receives this fallback.
  if (!selected && env === process.env && process.platform !== "win32") selected = "C:\\Windows";

  if (!selected || !win32.isAbsolute(selected) || selected.startsWith("\\\\")) {
    throw new Error("windows_system_root_unavailable");
  }
  if (systemRoot && windowsDirectory && normalized(systemRoot) !== normalized(windowsDirectory)) {
    throw new Error("windows_system_root_mismatch");
  }

  const root = win32.resolve(selected);
  if (!/^[a-z]:\\/i.test(root) || /^[a-z]:\\?$/i.test(root)) {
    throw new Error("windows_system_root_invalid");
  }
  return root.replace(/\\+$/, "");
}

export function resolveWindowsSystemDirectory(options = {}) {
  return win32.join(resolveWindowsSystemRoot(options), "System32");
}

export function resolveWindowsSystemExecutable(name, options = {}) {
  const executable = typeof name === "string" ? name.toLowerCase() : "";
  if (!ALLOWED_EXECUTABLES.has(executable)) {
    throw new TypeError("windows_system_executable_not_allowed");
  }

  const root = resolveWindowsSystemRoot(options);
  if (executable === "powershell.exe") {
    return win32.join(root, "System32", "WindowsPowerShell", "v1.0", executable);
  }
  return win32.join(root, "System32", executable);
}

export function createWindowsSystemProcessOptions({
  env = process.env,
  platform = process.platform,
  extraEnv = {}
} = {}) {
  const systemRoot = resolveWindowsSystemRoot({ env, platform });
  const systemDirectory = win32.join(systemRoot, "System32");
  const moduleDirectory = win32.join(systemDirectory, "WindowsPowerShell", "v1.0", "Modules");
  const childEnv = {};

  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase();
    if (lower === "path" || lower === "psmodulepath" || lower === "systemroot" || lower === "windir") {
      continue;
    }
    childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(extraEnv)) {
    const lower = key.toLowerCase();
    if (lower === "path" || lower === "psmodulepath" || lower === "systemroot" || lower === "windir") {
      continue;
    }
    childEnv[key] = value;
  }

  return Object.freeze({
    cwd: systemDirectory,
    env: Object.freeze({
      ...childEnv,
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      PATH: systemDirectory,
      PSModulePath: moduleDirectory
    })
  });
}
