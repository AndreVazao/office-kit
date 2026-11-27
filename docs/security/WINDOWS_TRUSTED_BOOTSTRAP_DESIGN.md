# Windows trusted bootstrap and host-process boundary

Status: isolated probe prototype implemented; MSIX activation and trusted bootstrap not implemented.  
Related: #104, #110, #140, #141, PR #139.  
Last reviewed: 2026-11-27.

## Decision summary

Do not treat inherited `SystemRoot` or `WINDIR` as provenance. The current `windows-system-executable.mjs` checks syntax and consistency, but an attacker-controlled parent can supply two matching values that point to a decoy Windows tree. Absolute paths and a sanitized child `PATH` reduce search-order attacks; they do not authenticate the root.

A signed MSIX package with Package Integrity Enforcement (PICE) is a viable candidate for protecting packaged executable content and establishing a Windows-managed package identity. It is not, by itself, proof that a Node child was started through the intended bootstrapper, nor does it authenticate arbitrary environment variables or IPC messages. The implementation must prove the full activation and child-process chain on supported Windows versions.

Microsoft references:

- [Enforce Package Integrity Check](https://learn.microsoft.com/en-us/windows/msix/desktop/tamper-protection)
- [Sign an MSIX package — Package Integrity Enforcement](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview)
- [uap10:PackageIntegrity](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap10-packageintegrity)
- [uap10:Content](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap10-content)
- [MSIX on Windows 10 and Windows 11](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/msix-windows10-windows11)
- [GetSystemDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemdirectoryw)

## Security properties and non-properties

PICE is expected to make Windows validate the package's signed block map and package contents at deployment/runtime, and block launch with remediation when package files are detected as tampered. The manifest must explicitly include `uap10:PackageIntegrity` with `uap10:Content Enforcement="on"`; merely declaring the parent element is insufficient.

PICE does **not** establish any of the following by itself:

- that an environment variable was written by the bootstrapper;
- that a process was launched by the intended parent rather than directly by a user or another process;
- that a named-pipe client is the intended child;
- that a user-writable policy file is fresh rather than replayed;
- that the publisher certificate is trusted by every target machine;
- that a package feature is supported on every Windows SKU/build in the commercial support matrix.

The package's signed identity and runtime process identity must be checked using documented Windows APIs in the prototype. The package identity inherited by a full-trust child must be verified rather than assumed.

## Preferred architecture to prototype

1. **Signed package boundary.** Package the native bootstrapper, Node runtime, host modules and native helper inside one signed MSIX. Enable PICE in the package manifest. Do not place executable dependencies in a mutable external directory.
2. **OS activation boundary.** Declare the native bootstrapper as the package's full-trust desktop entry point and test activation through the Windows package activation mechanism. The bootstrapper calls `GetSystemDirectoryW` directly; it never derives System32 from `SystemRoot`, `WINDIR`, `PATH`, current directory or caller-supplied arguments.
3. **Constrained child launch.** The bootstrapper launches the packaged Node runtime by a verified package-relative absolute path. Do not pass the system directory as an authority-bearing environment variable. Environment is configuration, not trust.
4. **No generic system-command launcher.** Remove production dependencies on `powershell.exe`, `whoami.exe` and `icacls.exe` where practical. Replace SID lookup with `GetTokenInformation(TokenUser)`, ACL changes with native security-descriptor/ACL APIs, CNG operations with NCrypt APIs, and signature checks with the native WinTrust helper. Keep the helper's executable and all code inside the PICE-protected package. If a system executable remains necessary, it must be invoked only through a separately reviewed native broker that obtains its path from `GetSystemDirectoryW` and accepts a fixed operation enum, never an arbitrary path or command.
5. **Authenticated host handoff.** Prefer a private inherited IPC channel created by the bootstrapper with an explicit handle-inheritance allowlist. The host must validate the channel type, protocol version, operation allowlist, message size, nonce/sequence and peer process/package identity. Do not authenticate the channel solely with a pipe name, PID, command-line value or environment variable. If peer identity cannot be proven, startup fails closed.
6. **Policy and anti-replay remain separate.** Publisher policy must remain bound to installation ID and edition and be verified by native WinTrust/CNG. The monotonic anti-replay anchor in #141 must live outside the user-writable profile and have crash-safe update/recovery semantics. MSIX PICE does not replace this control.

The native broker option is not approved until its peer-authentication and handle-inheritance design is proven against direct-launch, handle-substitution, pipe-squatting, PID-reuse and same-user process attacks. If those properties cannot be established reliably, eliminate the broker and implement the required OS operations in the native package entry point itself.

## Why the current resolver is not a mitigation closure

`resolveWindowsSystemRoot()` currently accepts inherited `SystemRoot` or `WINDIR`, checks absolute drive paths and rejects inconsistent pairs. A hostile parent can set both values consistently to a decoy directory. `createWindowsSystemProcessOptions()` then places that derived directory in child environment and working directory. Sanitizing `PATH` does not fix forged provenance.

The current production host uses these system executables for publisher-policy key reading, user SID lookup, ACL application and WinTrust helper invocation. Each call site must be removed or moved behind a trusted native boundary before #140 can close. Tests must prove that decoy executables in CWD and PATH are never executed and that forged environment values cannot influence any privileged path.

## Required prototype layout

The first implementation slice should be isolated under `tools/windows/msix-prototype/` and `native/windows/OfficeKit.Bootstrapper/`, with no change to the existing production launcher until the prototype has passed its tests.

Required artifacts:

- MSIX manifest with explicit full-trust desktop entry point and PICE enforcement.
- Minimal native bootstrapper that reports package identity, obtains System32 via `GetSystemDirectoryW`, launches only the package-relative Node executable, and records the child process identity.
- A native test probe that reports package identity, executable image path, parent PID, current directory and selected environment fields without executing system commands.
- A tamper test that modifies a staged package file and demonstrates Windows blocks activation or triggers documented remediation.
- A direct-launch test proving that bypassing the declared package entry point is rejected by the host.
- A forged-`SystemRoot`/`WINDIR` test proving those values have no authority.
- A decoy `powershell.exe`, `whoami.exe` and `icacls.exe` test in both CWD and PATH.
- IPC tests for missing, malformed, replayed, oversized and wrong-peer messages.
- A physical Windows 11 acceptance run and a separately supported Windows 10 SKU/build run if Windows 10 remains in the support policy.

No production code should be changed by the prototype until these tests demonstrate the claimed properties.

## Platform support decision

Microsoft's current MSIX feature matrix states that PICE for non-Store packages requires Windows 10 version 2004/build 19041 or later and is available on Windows 11. The same matrix states that Windows 10 non-LTSC mainstream support ended on 2025-10-14, and that MSIX Persistent Identity is Windows 11-only. Therefore:

- Windows 10 build 19045 compatibility is not a sufficient commercial support commitment.
- Do not depend on MSIX Persistent Identity for Windows 10.
- Define a supported Windows 11 baseline for commercial distribution unless a specific supported Windows 10 LTSC/ESU target is deliberately selected.
- Treat the user's Windows 10 Home PC as a development/compatibility target only until its support and security-update status is confirmed.

## Acceptance gates

| Gate | Required evidence | Failure behavior |
|---|---|---|
| Package signature | Trusted publisher chain and signed manifest/block map | Reject install/activation |
| PICE | Runtime tamper detection on each supported OS | Reject launch; allow Windows repair flow |
| Entry-point activation | Windows launches the declared bootstrapper | Reject direct/unverified launch |
| Package identity | Bootstrapper and host report expected package family/full name | Fail closed |
| System directory | Bootstrapper calls `GetSystemDirectoryW`; no inherited-root dependency | Fail closed |
| Child process | Node image is within the expected package and identity is verified | Fail closed |
| System operations | No untrusted search path or arbitrary command/path input | Fail closed |
| IPC | Peer identity, handle/channel and protocol all validated | Fail closed |
| Publisher policy | Installation/edition binding, native signature verification and ACLs | Fail closed |
| Anti-replay | Protected monotonic anchor and crash/restore tests | Fail closed |
| Lifecycle | Install/update/repair/rollback/uninstall and identity/data retention tested | Do not release |

## Prototype checkpoint — 2026-11-26

An isolated .NET 8 Windows probe now exists under `native/windows/OfficeKit.Bootstrapper/`. It calls `GetSystemDirectoryW` directly and queries `GetCurrentPackageFullName`; it does not read inherited `SystemRoot`/`WINDIR` as the system-directory source. The Windows CI workflow builds and runs it twice, including with both variables forged to the same decoy root, and compares the OS API result. The ordinary GitHub-hosted runner is expected to report `not_packaged`.

This is deliberately a diagnostic probe, not the declared MSIX entry point. It does not launch Node, authenticate a parent or child, establish package activation, verify PICE/tamper blocking, or provide an IPC handoff. Passing this probe cannot close #104 or #140. The next step is a signed package manifest and activation experiment, not wiring this executable into production.

## Explicit non-claims

This document is a design proposal, not an implementation, test report, installer decision or release approval. No Windows trust boundary is considered closed by documentation alone. PR #139 remains Draft; issues #104, #110, #140 and #141 remain open until their respective implementation and validation evidence exists.


## Exact-head probe validation — 2026-11-26 14:06 UTC

The isolated .NET 8 probe at `native/windows/OfficeKit.Bootstrapper/` passed the normal and forged-matching-environment checks on the code checkpoint `26dcb98a2abbe2143615dd2182e4e71ea9903eb1`. CI [#45834056733](https://github.com/AndreVazao/office-kit/actions/runs/45834056733) passed all four Linux/Windows Node 22/26.13.1 jobs; visual regression [#45834056699](https://github.com/AndreVazao/office-kit/actions/runs/45834056699) passed on that exact SHA. A subsequent documentation-only commit changes the PR head and must be validated independently.

The probe obtains System32 through `GetSystemDirectoryW` and package identity through `GetCurrentPackageFullName`. It does not activate from a signed MSIX, enforce Package Integrity Enforcement, launch Node, authenticate a parent/child handoff or provide an IPC protocol. The production `windows-system-executable.mjs` resolver still derives its root from inherited `SystemRoot`/`WINDIR`; issue #140 remains open. The publisher-policy anti-replay anchor in #141 also remains unsupported. Do not treat this probe as a production bootstrapper or binary-planting fix.

The Windows Node 22 test timeout on the preceding PR head was investigated and corrected; the native WinTrust test remains enabled and passed in a dedicated Windows CI step on `26dcb98`. These results are runner-level evidence only, not physical-PC or commercial-package acceptance.


## 2026-11-27 — unsigned MSIX structural prototype and CI correction

PR #139 added an isolated MSIX packaging experiment under tools/windows/msix-prototype/. On the code checkpoint 2ead8f6a544303e5525bacbe37db5c4a23c38bf5, CI [#46008048821](https://github.com/AndreVazao/office-kit/actions/runs/46008048821) passed all four Ubuntu/Windows Node 22/26.13.1 jobs and visual regression [#46008048810](https://github.com/AndreVazao/office-kit/actions/runs/46008048810) passed on the same SHA. Both Windows jobs built the .NET probe, ran the forged-SystemRoot/WINDIR check, built and unpacked the unsigned MSIX, inspected the manifest/block map/executable, and completed the existing CNG/WinTrust and three portable edition bundle tests.

The MSIX output is deliberately unsigned and uses a development-only publisher. The bootstrapper executable is still a diagnostic probe: it reports GetSystemDirectoryW and package identity, then exits. It does not launch Node, authenticate a parent/child handoff, install/activate the package, demonstrate runtime PICE tamper blocking, or implement upgrade/rollback/repair/uninstall. Issues #104, #110, #140 and #141 remain open. No installer or production readiness is claimed.

The preceding exact head 868769e291613ac12c02c724779943ae11c946e8 had a real test failure: windows-service-inspection.test.mjs still expected 60 seconds to be rejected after the implementation raised its maximum to 90 seconds to accommodate the 60-second CIM operation timeout plus process overhead. The test was corrected on 2ead8f6 to reject values below 250 ms and above 90 seconds, and to accept/assert the 90-second upper boundary. No failing test was skipped or suppressed.

The MSIX prototype build is being hardened to refuse filesystem roots, the repository root, output paths containing the repository, reparse-point output directories and non-empty output directories. It no longer recursively deletes a caller-supplied output path. New Windows CI tests verify that a sentinel file in a non-empty output directory remains unchanged. This additional guard is awaiting validation on the next exact PR head.
