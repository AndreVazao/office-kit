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

$sceneTarget = Join-Path $bundleRoot "packages\scene-engine"
$hostTarget = Join-Path $bundleRoot "packages\windows-host"
New-Item -ItemType Directory -Path $sceneTarget -Force | Out-Null
New-Item -ItemType Directory -Path $hostTarget -Force | Out-Null

Copy-Item -LiteralPath $nodePath -Destination (Join-Path $bundleRoot "node.exe")
Copy-Item -LiteralPath (Join-Path $repoRoot "packages\scene-engine\src") -Destination $sceneTarget -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot "packages\windows-host\src") -Destination $hostTarget -Recurse
Copy-Item -LiteralPath $helperPath -Destination (Join-Path $bundleRoot "OfficeKit.CngHost.exe")
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $bundleRoot "LICENSE") -ErrorAction SilentlyContinue

$package = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$nodeVersion = (& $nodePath --version).Trim()
$manifest = [ordered]@{
  product = "Office Kit Digital"
  edition = "Universal"
  version = [string]$package.version
  architecture = "win-x64"
  nodeVersion = $nodeVersion
  minimumNodeVersion = "22.5"
  entrypoint = "packages/windows-host/src/cli.mjs"
  cngHelper = "OfficeKit.CngHost.exe"
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
