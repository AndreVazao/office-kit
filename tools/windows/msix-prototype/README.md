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

## What this slice can prove

- MakeAppx successfully unpacks the produced package as the SDK-supported structural verification pass; the unpacked manifest, executable and block map are inspected.
- The unpacked package contains its manifest, block map, and executable.
- The packed manifest declares the full-trust packaged desktop application.
- The packed manifest retains explicit PICE enforcement.
- The declared executable is the self-contained .NET probe.

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
