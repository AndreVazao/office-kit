[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Add", "Remove")]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath,
  [Parameter(Mandatory = $true)]
  [string]$Thumbprint
)

$ErrorActionPreference = "Stop"

if ($Thumbprint -notmatch "^[A-Fa-f0-9]{40}$") {
  throw "Temporary publisher thumbprint is invalid."
}
if ($env:GITHUB_ACTIONS -ne "true") {
  throw "Temporary publisher trust may only be changed inside a disposable GitHub Actions runner."
}

function Get-CurrentUserCertificates {
  param([Parameter(Mandatory = $true)][string]$StoreName)
  $parsedStoreName = [System.Enum]::Parse(
    [System.Security.Cryptography.X509Certificates.StoreName],
    $StoreName,
    $false
  )
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    $parsedStoreName,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    return $store.Certificates.Find(
      [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $Thumbprint,
      $false
    )
  } finally {
    $store.Close()
  }
}

$certificate = $null
try {
  if ($Action -eq "Add") {
    if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
      throw "Temporary public certificate file is missing."
    }
    $certificateBytes = [System.IO.File]::ReadAllBytes($CertificatePath)
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateBytes)
    if ($certificate.Thumbprint -ne $Thumbprint) {
      throw "Temporary public certificate thumbprint does not match the requested publisher."
    }

    foreach ($storeName in @("Root", "TrustedPublisher")) {
      if ((Get-CurrentUserCertificates -StoreName $storeName).Count -ne 0) {
        throw ("Refusing to overwrite an existing CurrentUser " + $storeName + " certificate.")
      }
    }

    # Use the documented CryptoAPI system-store function directly. This adds
    # the encoded public certificate without invoking an interactive import
    # wizard or changing any LocalMachine store.
    $source = @'
using System;
using System.Runtime.InteropServices;
public static class OfficeKitCurrentUserRootStore {
  [DllImport("crypt32.dll", EntryPoint = "CertAddEncodedCertificateToSystemStoreW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool Add(string storeName, byte[] encodedCertificate, UInt32 encodedLength);
}
'@
    Add-Type -TypeDefinition $source -ErrorAction Stop
    $rootAdded = [OfficeKitCurrentUserRootStore]::Add("ROOT", $certificateBytes, [UInt32]$certificateBytes.Length)
    if (-not $rootAdded) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw ("CertAddEncodedCertificateToSystemStoreW failed with Win32 error " + $errorCode + ".")
    }
    if ((Get-CurrentUserCertificates -StoreName "Root").Count -ne 1) {
      throw "Temporary publisher root was not present after installation."
    }

    $publisherStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
      [System.Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher,
      [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
    )
    try {
      $publisherStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $publisherStore.Add($certificate)
    } finally {
      $publisherStore.Close()
    }
    if ((Get-CurrentUserCertificates -StoreName "TrustedPublisher").Count -ne 1) {
      throw "Temporary publisher was not uniquely present in CurrentUser TrustedPublisher."
    }
    Write-Output "Added ephemeral publisher to CurrentUser Root and TrustedPublisher."
  } else {
    foreach ($storeName in @("Root", "TrustedPublisher")) {
      $matches = Get-CurrentUserCertificates -StoreName $storeName
      if ($matches.Count -gt 0) {
        $parsedStoreName = [System.Enum]::Parse(
          [System.Security.Cryptography.X509Certificates.StoreName],
          $storeName,
          $false
        )
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
          $parsedStoreName,
          [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
        )
        try {
          $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
          foreach ($entry in $matches) { $store.Remove($entry) }
        } finally {
          $store.Close()
        }
      }
      if ((Get-CurrentUserCertificates -StoreName $storeName).Count -ne 0) {
        throw ("Temporary publisher cleanup failed in CurrentUser " + $storeName + ".")
      }
    }
    Write-Output "Removed ephemeral publisher from CurrentUser Root and TrustedPublisher."
  }
} finally {
  if ($certificate) {
    $certificate.Dispose()
  }
}
