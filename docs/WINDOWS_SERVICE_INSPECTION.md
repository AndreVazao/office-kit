# Windows service inspection — read-only boundary

## Implemented contract

`packages/windows-host/src/windows-service-inspection.mjs` inspects exactly one service explicitly selected by the caller. The caller must provide both the exact Windows service name and the expected absolute executable path.

- Uses a fixed PowerShell command and passes the service name through a child-process environment variable; no shell interpolation or shell execution is enabled.
- Uses CIM `Win32_Service` to read service name, state, start mode, executable command line, process ID and service account.
- Requires exactly one matching service and exact service-name equality.
- Extracts the executable path and compares normalized Windows paths against the configured expected executable.
- Validates state, start mode, PID and service account fields; ambiguous or malformed results fail closed.
- Process execution is bounded (250 ms–15 s, default 5 s), output is capped at 64 KiB, and error output is never returned to callers.
- The API is inspection-only. It does not start, stop, restart, install, reconfigure, terminate or delete services/processes.

## Validation and limitations

Automated tests inject the process runner and verify command construction, no shell, bounded timeout, identity/path mismatch rejection, malformed data rejection and fail-closed process errors. These tests do not execute CIM on a Windows host.

This is not yet a lifecycle driver and is not connected to `createInstallationLifecycleRuntime`. No Office Kit Windows service is registered by this change; the module only provides a safe inspection primitive for a future explicitly installed service. No DGM-MAT or VST backend is inspected or modified. Native Windows runner validation remains required before integration.
