# Office Kit Windows bootstrap probe

This project is an isolated, probe-only first slice for the trusted-bootstrap investigation.

## What it does

- Calls the Windows API \`GetSystemDirectoryW\` directly to obtain the system directory.
- Queries the current process package identity through \`GetCurrentPackageFullName\` and \`GetCurrentPackageFamilyName\`.
- Emits one JSON record for CI and local inspection.
- When activated with package identity, writes a uniquely named diagnostic marker to that package's \`LocalState\` directory. The marker lets the CI integration prove that Windows Shell activated the packaged executable rather than a directly invoked unpackaged copy.
- Does not read \`SystemRoot\`, \`WINDIR\`, \`PATH\`, the current directory or command-line values as a source of system-directory authority.

Run the unpackaged probe on Windows:

\`\`\`powershell
dotnet run --project native/windows/OfficeKit.Bootstrapper/OfficeKit.Bootstrapper.csproj --configuration Release -- --probe
\`\`\`

## MSIX activation integration

The Windows CI additionally:

1. Builds the unsigned prototype package and inspects its manifest and block map.
2. Creates an ephemeral self-signed code-signing certificate whose subject matches the prototype manifest publisher.
3. Imports the public certificate into the runner's Local Machine Trusted People store.
4. Signs the MSIX, installs it with \`Add-AppxPackage\`, and activates it through the Windows Shell AppsFolder identity.
5. Verifies the package full name/family name and the OS-derived System32 path reported by the packaged process.
6. Verifies that the installed manifest still declares Package Integrity Enforcement.
7. Uninstalls the package and removes the temporary certificate from the runner trust store.

The signing key and trust entry are generated per CI job and are not repository secrets or production publisher credentials. The activation script uses Windows PowerShell 5.1 because the Appx deployment cmdlets are Windows PowerShell components. Local execution requires an elevated disposable Windows environment because the test temporarily writes to the Local Machine Trusted People store; cleanup is enforced in the script's \`finally\` block.

## Explicit limits

This remains **a diagnostic MSIX activation experiment**, not a production installer or launcher.

- The package uses a development-only self-signed publisher.
- The bootstrapper does not launch Node or the Office Kit host.
- The integration proves signed package installation and Windows Shell activation on the CI runner, not commercial publisher trust.
- The manifest declares Package Integrity Enforcement, but runtime tamper blocking has not been exercised.
- It does not authenticate a parent/child relationship or IPC handoff to a host process.
- It does not provision the installation CNG publisher-policy key or signed policy file.
- It does not implement upgrade, rollback, repair, retained-data policy or complete uninstall recovery.
- It does not replace physical-PC acceptance on the supported Windows versions.

A passing CI activation test is not evidence that the final Universal, DGM-MAT or VST installers are production-ready. Do not wire this probe into production launch paths.
