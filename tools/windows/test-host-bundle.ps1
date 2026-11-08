[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BundleDirectory
)

$ErrorActionPreference = "Stop"
$bundleRoot = (Resolve-Path $BundleDirectory).Path
$nodePath = Join-Path $bundleRoot "node.exe"
$helperPath = Join-Path $bundleRoot "OfficeKit.CngHost.exe"
$cliPath = Join-Path $bundleRoot "packages\windows-host\src\cli.mjs"

foreach ($required in @($nodePath, $helperPath, $cliPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw ("Portable host bundle is incomplete: " + $required)
  }
}

$oldLocalAppData = $env:LOCALAPPDATA
$oldHelperPath = $env:OFFICE_KIT_CNG_HOST_PATH
$oldThumbprint = $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT
$tempRoot = Join-Path $env:TEMP ("OfficeKitPortableHost-" + [guid]::NewGuid().ToString("N"))
$testLocalAppData = Join-Path $tempRoot "LocalAppData"
$certificate = $null
$certificateFile = Join-Path $tempRoot "office-kit-ci-publisher.cer"

function Invoke-OfficeKitHost {
  param([string[]]$Arguments)
  $output = & $nodePath $cliPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Office Kit host command failed (" + ($Arguments -join " ") + "): " + ($output -join [Environment]::NewLine))
  }
  return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $testLocalAppData -Force | Out-Null

  $certificate = New-SelfSignedCertificate -Subject "CN=Office Kit CI Ephemeral Publisher" -Type CodeSigningCert -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256

  Export-Certificate -Cert $certificate -FilePath $certificateFile | Out-Null
  Import-Certificate -FilePath $certificateFile -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
  Import-Certificate -FilePath $certificateFile -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null

  $signature = Set-AuthenticodeSignature -FilePath $helperPath -Certificate $certificate -HashAlgorithm SHA256
  if ($signature.Status -ne "Valid") {
    throw ("CI signing failed: " + $signature.Status + " " + $signature.StatusMessage)
  }

  $env:LOCALAPPDATA = $testLocalAppData
  $env:OFFICE_KIT_CNG_HOST_PATH = $helperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint

  $initial = Invoke-OfficeKitHost -Arguments @("health")
  if ($initial.status -ne "ready" -or $initial.identityStatus -ne "empty") {
    throw "First portable host start did not report a clean empty identity state."
  }

  $created = Invoke-OfficeKitHost -Arguments @(
    "create-identity",
    "--organization-id=office-kit-ci",
    "--node-id=windows-portable-host-ci"
  )
  if ($created.status -ne "created" -or $created.generation -ne 1) {
    throw "Portable host identity creation failed."
  }

  $reopened = Invoke-OfficeKitHost -Arguments @("health")
  if ($reopened.status -ne "ready" -or $reopened.identityStatus -ne "active" -or $reopened.identity.generation -ne 1) {
    throw "Portable host did not recover the identity in a fresh process."
  }

  $rotated = Invoke-OfficeKitHost -Arguments @("rotate-identity")
  if ($rotated.status -ne "rotated" -or $rotated.generation -ne 2) {
    throw "Portable host identity rotation failed."
  }

  $revoked = Invoke-OfficeKitHost -Arguments @("revoke-identity")
  if ($revoked.status -ne "revoked") {
    throw "Portable host identity revocation failed."
  }

  $finalHealth = Invoke-OfficeKitHost -Arguments @("health")
  if ($finalHealth.status -ne "ready" -or $finalHealth.identityStatus -ne "revoked" -or $null -ne $finalHealth.identity) {
    throw "Portable host did not report the revoked identity state after process restart."
  }

  Write-Output "Portable Windows host bundle passed: signed helper trust, local SQLite, CNG identity create/reopen/rotate/revoke."
}
finally {
  $officeKitData = Join-Path $testLocalAppData "OfficeKit"
  if (Test-Path -LiteralPath $officeKitData) {
    & icacls.exe $officeKitData /reset /T /C | Out-Null
  }

  if ($null -ne $certificate) {
    foreach ($store in @("My", "Root", "TrustedPublisher")) {
      Remove-Item -LiteralPath ("Cert:\CurrentUser\" + $store + "\" + $certificate.Thumbprint) -Force -ErrorAction SilentlyContinue
    }
  }

  $env:LOCALAPPDATA = $oldLocalAppData
  $env:OFFICE_KIT_CNG_HOST_PATH = $oldHelperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $oldThumbprint

  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
