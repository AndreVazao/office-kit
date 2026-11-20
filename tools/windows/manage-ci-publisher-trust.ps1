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
      Write-Output ("Opening CurrentUser " + $storeName + " store for isolated CI trust.")
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
        $existing = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($existing.Count -ne 0) {
          throw ("Refusing to overwrite an existing CurrentUser " + $storeName + " certificate.")
        }
        Write-Output ("Adding ephemeral certificate to CurrentUser " + $storeName + ".")
        $store.Add($certificate)
        $matches = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($matches.Count -ne 1) {
          throw ("Temporary publisher was not uniquely present in CurrentUser " + $storeName + ".")
        }
        foreach ($entry in $matches) { $entry.Dispose() }
      } finally {
        $store.Close()
      }
      Write-Output ("CurrentUser " + $storeName + " trust entry installed.")
    }
  } else {
    foreach ($storeName in @("Root", "TrustedPublisher")) {
      Write-Output ("Opening CurrentUser " + $storeName + " store for cleanup.")
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
        $matches = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        foreach ($entry in $matches) {
          $store.Remove($entry)
          $entry.Dispose()
        }
        $remaining = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($remaining.Count -ne 0) {
          throw ("Temporary publisher cleanup failed in CurrentUser " + $storeName + ".")
        }
        foreach ($entry in $remaining) { $entry.Dispose() }
      } finally {
        $store.Close()
      }
      Write-Output ("CurrentUser " + $storeName + " trust entry removed and verified.")
    }
  }
} finally {
  if ($certificate) {
    $certificate.Dispose()
  }
}
