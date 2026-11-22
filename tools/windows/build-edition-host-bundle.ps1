[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("DGM-MAT", "VST")]
  [string]$Edition,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$helperPath = $env:OFFICE_KIT_CNG_HOST_PATH

if ([string]::IsNullOrWhiteSpace($helperPath) -or -not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
  throw "OFFICE_KIT_CNG_HOST_PATH must point to the published OfficeKit.CngHost.exe."
}

$nodeCommand = Get-Command "node.exe" -ErrorAction Stop
$nodePath = $nodeCommand.Source
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $editionKeyForPath = if ($Edition -eq "DGM-MAT") { "dgmat" } else { "vst" }
  $OutputDirectory = Join-Path $repoRoot ("artifacts\windows-host-bundle-" + $editionKeyForPath)
}
$bundleRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
$artifactsPrefix = $artifactsRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $bundleRoot.StartsWith($artifactsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "The edition bundle output directory must be below the repository artifacts directory."
}
if (Test-Path -LiteralPath $bundleRoot) {
  Remove-Item -LiteralPath $bundleRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null

$editionKey = if ($Edition -eq "DGM-MAT") { "dgmat" } else { "vst" }
$entrypoint = if ($Edition -eq "DGM-MAT") {
  "packages/windows-host/src/dgmat-cli.mjs"
} else {
  "packages/windows-host/src/vst-cli.mjs"
}
$launcherName = if ($Edition -eq "DGM-MAT") { "office-kit-dgmat.cmd" } else { "office-kit-vst.cmd" }
$adapterAllowlist = if ($Edition -eq "DGM-MAT") { @("dgm-mat") } else { @("vazao-sovereign-trader") }
$excludedAdapters = if ($Edition -eq "DGM-MAT") { @("VST") } else { @("DGM-MAT") }

$nodeVersion = (& $nodePath --version).Trim()
if ($nodeVersion -notmatch '^v?(\d+)\.(\d+)\.(\d+)') {
  throw ("Could not parse bundled Node.js version: " + $nodeVersion)
}
$parsedNodeVersion = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
if ($parsedNodeVersion -lt [version]"22.5.0") {
  throw ("Edition Windows bundle requires Node.js >=22.5.0; found " + $nodeVersion)
}
$nodeArchitecture = (& $nodePath -p "process.arch").Trim()
if ($nodeArchitecture -ne "x64") {
  throw ("Edition Windows bundle requires x64 Node.js; found " + $nodeArchitecture)
}

$allowlistCode = "import { getEditionFileAllowlist } from './scripts/build-edition.mjs'; const edition = process.argv[1]; process.stdout.write(JSON.stringify(getEditionFileAllowlist(edition)));"
$allowlistJson = & $nodePath --input-type=module -e $allowlistCode $editionKey
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($allowlistJson -join ""))) {
  throw ("Could not resolve the " + $Edition + " source-package allowlist.")
}
$sourceFiles = @($allowlistJson -join "" | ConvertFrom-Json)
if ($sourceFiles.Count -lt 1 -or -not ($sourceFiles -contains "LICENSE")) {
  throw ("The " + $Edition + " edition allowlist is empty or does not contain LICENSE.")
}

$containsDgmatModules = @($sourceFiles | Where-Object { $_ -match "(^|/)dgmat-" }).Count -gt 0
$containsVstModules = @($sourceFiles | Where-Object { $_ -match "(^|/)vst-" }).Count -gt 0
if ($Edition -eq "DGM-MAT") {
  $hasEditionEntryPoints = ($sourceFiles -contains "packages/windows-host/src/dgmat-cli.mjs") -and ($sourceFiles -contains "packages/scene-engine/src/dgmat-windows-host.mjs")
  if (-not $hasEditionEntryPoints -or $containsVstModules) {
    throw "DGM-MAT allowlist is incomplete or contains VST-specific modules."
  }
} else {
  $hasEditionEntryPoints = ($sourceFiles -contains "packages/windows-host/src/vst-cli.mjs") -and ($sourceFiles -contains "packages/scene-engine/src/vst-windows-host.mjs")
  if (-not $hasEditionEntryPoints -or $containsDgmatModules) {
    throw "VST allowlist is incomplete or contains DGM-MAT-specific modules."
  }
}

foreach ($relative in $sourceFiles) {
  $relativeWindows = $relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $source = Join-Path $repoRoot $relativeWindows
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw ("Required " + $Edition + " source file is missing: " + $relative)
  }
  $destination = Join-Path $bundleRoot $relativeWindows
  $destinationDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $bundleRoot "node.exe")
Copy-Item -LiteralPath $helperPath -Destination (Join-Path $bundleRoot "OfficeKit.CngHost.exe")

$package = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$sceneModules = @($sourceFiles | Where-Object { $_.StartsWith("packages/scene-engine/src/") } | ForEach-Object { $_.Substring("packages/scene-engine/src/".Length) })
$hostModules = @($sourceFiles | Where-Object { $_.StartsWith("packages/windows-host/src/") } | ForEach-Object { $_.Substring("packages/windows-host/src/".Length) })
$manifest = [ordered]@{
  schemaVersion = 1
  product = "Office Kit Digital"
  edition = $Edition
  editionKey = $editionKey
  version = [string]$package.version
  architecture = "win-x64"
  nodeVersion = $nodeVersion
  nodeArchitecture = $nodeArchitecture
  minimumNodeVersion = "22.5.0"
  entrypoint = $entrypoint
  launcher = $launcherName
  cngHelper = "OfficeKit.CngHost.exe"
  sourceFiles = $sourceFiles
  sceneEngineModules = $sceneModules
  windowsHostModules = $hostModules
  adapterAllowlist = $adapterAllowlist
  excludedAdapters = $excludedAdapters
  backendAutoConnect = $false
  backendMode = "read-only"
  requiresTrustedAuthenticodePublisher = $true
  artifactType = "portable-windows-runtime-bundle"
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bundleRoot "bundle-manifest.json") -Encoding utf8

$entrypointWindows = $entrypoint.Replace("/", "\")
$launcher = @"
@echo off
setlocal
set "OFFICE_KIT_CNG_HOST_PATH=%~dp0OfficeKit.CngHost.exe"
"%~dp0node.exe" "%~dp0$entrypointWindows" %*
exit /b %ERRORLEVEL%
"@
Set-Content -LiteralPath (Join-Path $bundleRoot $launcherName) -Value $launcher -Encoding ascii

Write-Output ("Portable " + $Edition + " Windows bundle prepared at: " + $bundleRoot)
