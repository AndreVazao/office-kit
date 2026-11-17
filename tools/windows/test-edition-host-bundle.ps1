[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BundleDirectory,
  [Parameter(Mandatory = $true)]
  [ValidateSet("DGM-MAT", "VST")]
  [string]$Edition
)

$ErrorActionPreference = "Stop"
$bundleRoot = (Resolve-Path $BundleDirectory).Path
$manifestPath = Join-Path $bundleRoot "bundle-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Edition bundle manifest is missing."
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedKey = if ($Edition -eq "DGM-MAT") { "dgmat" } else { "vst" }
$expectedEntrypoint = if ($Edition -eq "DGM-MAT") {
  "packages/windows-host/src/dgmat-cli.mjs"
} else {
  "packages/windows-host/src/vst-cli.mjs"
}
$expectedLauncher = if ($Edition -eq "DGM-MAT") { "office-kit-dgmat.cmd" } else { "office-kit-vst.cmd" }
if ($manifest.edition -ne $Edition -or $manifest.editionKey -ne $expectedKey
  -or $manifest.entrypoint -ne $expectedEntrypoint -or $manifest.launcher -ne $expectedLauncher) {
  throw "Edition bundle manifest does not match the requested product."
}
if ($manifest.minimumNodeVersion -ne "22.5.0" -or $manifest.nodeArchitecture -ne "x64"
  -or $manifest.backendAutoConnect -ne $false -or $manifest.backendMode -ne "read-only") {
  throw "Edition bundle manifest violates the runtime or safe-default contract."
}

$nodePath = Join-Path $bundleRoot "node.exe"
$helperPath = Join-Path $bundleRoot "OfficeKit.CngHost.exe"
$launcherPath = Join-Path $bundleRoot $expectedLauncher
$entrypointPath = Join-Path $bundleRoot ($expectedEntrypoint.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
foreach ($required in @($nodePath, $helperPath, $launcherPath, $entrypointPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw ("Edition bundle is incomplete: " + $required)
  }
}

$actualNodeVersion = (& $nodePath --version).Trim()
$actualNodeArchitecture = (& $nodePath -p "process.arch").Trim()
if ($actualNodeVersion -ne $manifest.nodeVersion -or $actualNodeArchitecture -ne "x64") {
  throw "Bundled Node.js does not match the manifest."
}

$expectedFiles = @($manifest.sourceFiles | Sort-Object)
$rootExtras = @("node.exe", "OfficeKit.CngHost.exe", "bundle-manifest.json", $expectedLauncher)
$actualFiles = @(Get-ChildItem -LiteralPath $bundleRoot -File -Recurse |
  Where-Object { $rootExtras -notcontains $_.Name } |
  ForEach-Object { $_.FullName.Substring($bundleRoot.Length + 1).Replace("\", "/") } |
  Sort-Object)
if (Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles) {
  throw ("Edition bundle content differs from its source allowlist. Actual files: " + ($actualFiles -join ", "))
}

$actualSceneModules = @($manifest.sourceFiles | Where-Object { $_.StartsWith("packages/scene-engine/src/") } |
  ForEach-Object { $_.Substring("packages/scene-engine/src/".Length) } | Sort-Object)
$actualHostModules = @($manifest.sourceFiles | Where-Object { $_.StartsWith("packages/windows-host/src/") } |
  ForEach-Object { $_.Substring("packages/windows-host/src/".Length) } | Sort-Object)
if (Compare-Object -ReferenceObject @($manifest.sceneEngineModules | Sort-Object) -DifferenceObject $actualSceneModules) {
  throw "Edition bundle scene-engine manifest does not match the source allowlist."
}
if (Compare-Object -ReferenceObject @($manifest.windowsHostModules | Sort-Object) -DifferenceObject $actualHostModules) {
  throw "Edition bundle Windows-host manifest does not match the source allowlist."
}

if ($Edition -eq "DGM-MAT") {
  if (-not ($manifest.adapterAllowlist -contains "dgm-mat")
    -or ($manifest.sourceFiles | Where-Object { $_ -match "(^|/)vst-" }).Count -gt 0) {
    throw "DGM-MAT bundle contains an invalid adapter allowlist."
  }
} else {
  if (-not ($manifest.adapterAllowlist -contains "vazao-sovereign-trader")
    -or ($manifest.sourceFiles | Where-Object { $_ -match "(^|/)dgmat-" }).Count -gt 0) {
    throw "VST bundle contains an invalid adapter allowlist."
  }
}

$certificate = $null
$rootStore = $null
$publisherStore = $null
$oldHelperPath = $env:OFFICE_KIT_CNG_HOST_PATH
$oldThumbprint = $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT
$oldLocalAppData = $env:LOCALAPPDATA
$launcherDataRoot = Join-Path $env:TEMP ("OfficeKit-EditionLauncher-" + [guid]::NewGuid().ToString("N"))
$runnerPath = Join-Path $PSScriptRoot "edition-host-bundle-test-runner.mjs"

try {
  $certificate = New-SelfSignedCertificate -Subject ("CN=Office Kit Edition Bundle CI " + [guid]::NewGuid().ToString("N")) -Type CodeSigningCert -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256

  $rootStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  $publisherStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  $rootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  $publisherStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  $rootStore.Add($certificate)
  $publisherStore.Add($certificate)

  $signature = Set-AuthenticodeSignature -FilePath $helperPath -Certificate $certificate -HashAlgorithm SHA256
  $verifiedSignature = Get-AuthenticodeSignature -FilePath $helperPath
  if ($signature.Status -ne "Valid" -or $verifiedSignature.Status -ne "Valid"
    -or $verifiedSignature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
    throw "The temporary CI publisher did not produce a trusted helper signature."
  }

  $env:OFFICE_KIT_CNG_HOST_PATH = $helperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint
  New-Item -ItemType Directory -Path $launcherDataRoot -Force | Out-Null
  $env:LOCALAPPDATA = $launcherDataRoot
  $launcherOutput = & $launcherPath "health" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw ("Edition launcher health smoke test failed: " + ($launcherOutput -join [Environment]::NewLine))
  }
  $launcherResult = ($launcherOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if ($launcherResult.ok -ne $true -or $launcherResult.health.edition -ne $expectedKey
    -or $launcherResult.health.adapterConnected -ne $false) {
    throw "Edition launcher did not start disconnected with the expected edition identity."
  }
  $runnerOutput = & $nodePath $runnerPath $bundleRoot $Edition
  if ($LASTEXITCODE -ne 0) {
    throw ("Edition bundle CLI smoke test failed: " + ($runnerOutput -join [Environment]::NewLine))
  }
  $runnerResult = ($runnerOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if ($runnerResult.status -ne "passed" -or $runnerResult.edition -ne $Edition) {
    throw "Edition bundle CLI smoke test did not report the expected product."
  }

  Write-Output ("Portable " + $Edition + " Windows bundle passed content-isolation and disconnected CLI smoke tests.")
} finally {
  $env:OFFICE_KIT_CNG_HOST_PATH = $oldHelperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $oldThumbprint
  $env:LOCALAPPDATA = $oldLocalAppData
  if (Test-Path -LiteralPath $launcherDataRoot) {
    Remove-Item -LiteralPath $launcherDataRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($rootStore) {
    try {
      if ($certificate) { $rootStore.Remove($certificate) }
    } catch { }
    $rootStore.Close()
  }
  if ($publisherStore) {
    try {
      if ($certificate) { $publisherStore.Remove($certificate) }
    } catch { }
    $publisherStore.Close()
  }
  if ($certificate) {
    Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $certificate.Thumbprint) -Force -ErrorAction SilentlyContinue
  }
}
