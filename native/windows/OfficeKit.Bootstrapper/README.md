# Office Kit Windows bootstrap probe

This project is an isolated, probe-only first slice for the trusted-bootstrap investigation.

## What it does

- Calls the Windows API `GetSystemDirectoryW` directly to obtain the system directory.
- Queries the current process package identity through `GetCurrentPackageFullName`.
- Emits one JSON record for CI and local inspection.
- Does not read `SystemRoot`, `WINDIR`, `PATH`, the current directory or command-line values as a source of system-directory authority.

Run on Windows:

```powershell
dotnet run --project native/windows/OfficeKit.Bootstrapper/OfficeKit.Bootstrapper.csproj --configuration Release -- --probe
```

## Explicit limits

This is **not** a trusted bootstrapper, MSIX package, installer, launcher or production host component. It does not launch Node, pass authority to another process, authenticate a parent/child relationship, or prove that Windows package activation invoked it. A normal CI execution is expected to report `not_packaged`.

The probe demonstrates only that this process can call the documented OS API and query its own package identity. A signed MSIX manifest, PICE, OS activation test, child-process identity validation, IPC design and physical Windows acceptance remain separate gates. Do not wire this project into production launch paths.
