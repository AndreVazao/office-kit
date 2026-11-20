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
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
      [System.IO.File]::ReadAllBytes($CertificatePath)
    )
    if ($certificate.Thumbprint -ne $Thumbprint) {
      throw "Temporary public certificate thumbprint does not match the requested publisher."
    }
  }

  foreach ($storeName in @("TrustedPublisher")) {
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
      $existingCertificates = $store.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $Thumbprint,
        $false
      )

      if ($Action -eq "Add") {
        if ($existingCertificates.Count -ne 0) {
          throw ("Refusing to overwrite an existing CurrentUser " + $storeName + " certificate.")
        }
        $store.Add($certificate)
        $verified = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($verified.Count -ne 1) {
          throw ("Temporary publisher was not uniquely present in CurrentUser " + $storeName + ".")
        }
        Write-Output ("Added ephemeral publisher to CurrentUser " + $storeName + ".")
      } else {
        foreach ($entry in $existingCertificates) {
          $store.Remove($entry)
        }
        $remaining = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($remaining.Count -ne 0) {
          throw ("Temporary publisher cleanup failed in CurrentUser " + $storeName + ".")
        }
        Write-Output ("Removed ephemeral publisher from CurrentUser " + $storeName + ".")
      }
    } finally {
      $store.Close()
    }
  }
} finally {
  if ($certificate) {
    $certificate.Dispose()
  }
}
