[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Add", "Remove")]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath,
  [Parameter(Mandatory = $true)]
  [string]$Thumbprint,
  [Parameter(Mandatory = $true)]
  [string]$LogPath
)

$ErrorActionPreference = "Stop"

if ($Thumbprint -notmatch "^[A-Fa-f0-9]{40}$") {
  throw "Temporary publisher thumbprint is invalid."
}
if ($env:GITHUB_ACTIONS -ne "true") {
  throw "Temporary publisher trust may only be changed inside a disposable GitHub Actions runner."
}

$logRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$resolvedLogPath = [System.IO.Path]::GetFullPath($LogPath)
$logPrefix = $logRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedLogPath.StartsWith($logPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Trust diagnostics must remain inside the temporary runner directory."
}

function Write-TrustProgress {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = ([DateTime]::UtcNow.ToString("o") + " " + $Message)
  Add-Content -LiteralPath $resolvedLogPath -Value $line -Encoding utf8
  Write-Output $Message
}

$certificate = $null
try {
  if ($Action -eq "Add") {
    if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
      throw "Temporary public certificate file is missing."
    }

    Write-TrustProgress "Reading temporary public certificate."
    $certificateBytes = [System.IO.File]::ReadAllBytes($CertificatePath)
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateBytes)
    if ($certificate.Thumbprint -ne $Thumbprint) {
      throw "Temporary public certificate thumbprint does not match the requested publisher."
    }

    foreach ($storeName in @("Root", "TrustedPublisher")) {
      Write-TrustProgress ("Opening CurrentUser " + $storeName + " store.")
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
        Write-TrustProgress ("Opened CurrentUser " + $storeName + " store.")
        $existing = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($existing.Count -ne 0) {
          foreach ($entry in $existing) { $entry.Dispose() }
          throw ("Refusing to overwrite an existing CurrentUser " + $storeName + " certificate.")
        }
        Write-TrustProgress ("Adding ephemeral certificate to CurrentUser " + $storeName + ".")
        $store.Add($certificate)
        Write-TrustProgress ("Added ephemeral certificate to CurrentUser " + $storeName + ".")
        $matches = $store.Certificates.Find(
          [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
          $Thumbprint,
          $false
        )
        if ($matches.Count -ne 1) {
          foreach ($entry in $matches) { $entry.Dispose() }
          throw ("Temporary publisher was not uniquely present in CurrentUser " + $storeName + ".")
        }
        foreach ($entry in $matches) { $entry.Dispose() }
      } finally {
        $store.Close()
        Write-TrustProgress ("Closed CurrentUser " + $storeName + " store.")
      }
    }
    Write-TrustProgress "Ephemeral publisher trust installed in CurrentUser Root and TrustedPublisher."
  } else {
    foreach ($storeName in @("Root", "TrustedPublisher")) {
      Write-TrustProgress ("Opening CurrentUser " + $storeName + " store for cleanup.")
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
        Write-TrustProgress ("Opened CurrentUser " + $storeName + " store for cleanup.")
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
          foreach ($entry in $remaining) { $entry.Dispose() }
          throw ("Temporary publisher cleanup failed in CurrentUser " + $storeName + ".")
        }
        foreach ($entry in $remaining) { $entry.Dispose() }
      } finally {
        $store.Close()
        Write-TrustProgress ("Closed CurrentUser " + $storeName + " store after cleanup.")
      }
    }
    Write-TrustProgress "Ephemeral publisher removed from CurrentUser Root and TrustedPublisher."
  }
} finally {
  if ($certificate) {
    $certificate.Dispose()
  }
}
