[CmdletBinding()]
param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\..\artifacts\windows-host-bundle")
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$helperPath = $env:OFFICE_KIT_CNG_HOST_PATH

if ([string]::IsNullOrWhiteSpace($helperPath) -or -not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
  throw "OFFICE_KIT_CNG_HOST_PATH must point to the published OfficeKit.CngHost.exe."
}

$nodeCommand = Get-Command "node.exe" -ErrorAction Stop
$nodePath = $nodeCommand.Source
$bundleRoot = [System.IO.Path]::GetFullPath($OutputDirectory)

if (Test-Path -LiteralPath $bundleRoot) {
  Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}

$sceneTarget = Join-Path $bundleRoot "packages\scene-engine\src"
$hostTarget = Join-Path $bundleRoot "packages\windows-host\src"
New-Item -ItemType Directory -Path $sceneTarget -Force | Out-Null
New-Item -ItemType Directory -Path $hostTarget -Force | Out-Null

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $bundleRoot "node.exe")
$sceneModules = @(
  "windows.mjs",
  "windows-node-identity-runtime.mjs",
  "node-identity.mjs",
  "sqlite-node-identity-metadata-store.mjs",
  "node-identity-challenge-store.mjs",
  "windows-cng-p256-keystore.mjs",
  "resource-policy.mjs",
  "sqlite-office-incident-store.mjs",
  "exclusive-operation-lock.mjs",
  "sqlite-monotonic-checkpoint-journal.mjs",
  "office-health.mjs",
  "adapter-gateway.mjs",
  "runtime-session.mjs",
  "runtime-state.mjs",
  "adapter-contract.mjs"
)
foreach ($module in $sceneModules) {
  $source = Join-Path $repoRoot ("packages\scene-engine\src\" + $module)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw ("Required Universal scene module is missing: " + $module)
  }
  Copy-Item -LiteralPath $source -Destination $sceneTarget
}

$hostModules = @("cli.mjs", "hardware-capabilities.mjs", "installation-lifecycle.mjs", "sqlite-installation-lifecycle-store.mjs", "secret-vault.mjs", "process-lock.mjs", "index.mjs")
foreach ($module in $hostModules) {
  $source = Join-Path $repoRoot ("packages\windows-host\src\" + $module)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw ("Required Windows host module is missing: " + $module)
  }
  Copy-Item -LiteralPath $source -Destination $hostTarget
}
Copy-Item -LiteralPath $helperPath -Destination (Join-Path $bundleRoot "OfficeKit.CngHost.exe")
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $bundleRoot "LICENSE") -ErrorAction SilentlyContinue

$package = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$nodeVersion = (& $nodePath --version).Trim()
if ($nodeVersion -notmatch '^v?(\d+)\.(\d+)\.(\d+)') {
  throw ("Could not parse bundled Node.js version: " + $nodeVersion)
}
$parsedNodeVersion = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
if ($parsedNodeVersion -lt [version]"22.5.0") {
  throw ("Universal Windows bundle requires Node.js >=22.5.0; found " + $nodeVersion)
}
$nodeArchitecture = (& $nodePath -p "process.arch").Trim()
if ($nodeArchitecture -ne "x64") {
  throw ("Universal Windows bundle requires x64 Node.js; found " + $nodeArchitecture)
}
$manifest = [ordered]@{
  product = "Office Kit Digital"
  edition = "Universal"
  version = [string]$package.version
  architecture = "win-x64"
  nodeVersion = $nodeVersion
  nodeArchitecture = $nodeArchitecture
  minimumNodeVersion = "22.5.0"
  entrypoint = "packages/windows-host/src/cli.mjs"
  cngHelper = "OfficeKit.CngHost.exe"
  sceneEngineModules = $sceneModules
  windowsHostModules = $hostModules
  excludedBackendAdapters = @("DGM-MAT", "VST")
  requiresTrustedAuthenticodePublisher = $true
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundleRoot "bundle-manifest.json") -Encoding utf8

$launcher = @'
@echo off
set "OFFICE_KIT_CNG_HOST_PATH=%~dp0OfficeKit.CngHost.exe"
"%~dp0node.exe" "%~dp0packages\windows-host\src\cli.mjs" %*
exit /b %ERRORLEVEL%
'@
Set-Content -LiteralPath (Join-Path $bundleRoot "office-kit-host.cmd") -Value $launcher -Encoding ascii

Write-Output ("Windows host bundle prepared at: " + $bundleRoot)
