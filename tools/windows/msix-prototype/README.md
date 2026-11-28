# MSIX bootstrap activation prototype

Status: experimental packaging slice; not a trusted production bootstrapper.

This directory packages the existing .NET probe as a full-trust desktop MSIX
entry point. The manifest explicitly enables
`uap10:PackageIntegrity/uap10:Content Enforcement="on"`.

## Build

Run from the repository root on Windows with .NET 8 SDK and Windows SDK
(MakeAppx.exe) installed:

```powershell
pwsh -File tools/windows/msix-prototype/build-prototype.ps1
```

The script publishes the probe self-contained for x64, creates the required
development tile assets, and packs an **unsigned** MSIX. It does not create or
trust a signing certificate, install the package, or modify machine trust.

The manifest publisher is deliberately a development-only identity. It is not
the Office Kit commercial publisher and must never be reused for a release.

The output directory must be new or empty. The build script refuses filesystem
roots, the repository root, directories containing the repository, reparse-point
outputs and non-empty directories. It never recursively deletes caller-owned
output. Use a fresh path for each build. The Windows CI runs the output-directory
safety tests before building the package.

## What this slice can prove

- MakeAppx successfully unpacks the produced package as the SDK-supported structural verification pass; the unpacked manifest, executable and block map are inspected.
- The unpacked package contains its manifest, block map, and executable.
- The packed manifest declares the full-trust packaged desktop application.
- The packed manifest retains explicit PICE enforcement.
- After installation, the activation test checks for the PICE Process Trust Label ACE on the installed package directory.
- The activation test verifies that the ordinary CI process cannot acquire a write handle to the installed bootstrapper executable.
- The declared executable is the self-contained .NET probe.

The ACL/trust-label checks demonstrate an installed PICE protection boundary. They do
**not** simulate an offline or privileged on-disk modification, prove that Windows
runtime hash verification detects such a modification, or verify the repair/remediation
workflow. The test output therefore keeps `runtimeTamperBlockingVerified=false`.

## What it does not prove

- A signed package can be deployed on a clean target machine.
- Windows activates the declared entry point after trusted publisher validation.
- PICE blocks tampering on a physical supported Windows installation.
- A child Node process is launched or authenticated.
- Parent/child IPC, anti-replay, installer lifecycle, update, rollback, repair,
  uninstall, or data retention are secure.

The unsigned output cannot be installed as a trusted package. Signing and
physical activation/tamper acceptance are separate gates. Do not connect this
prototype to the production resolver or ordinary host startup.
