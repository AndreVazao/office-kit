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

function Invoke-BoundedCertUtil {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation,
    [string]$StandardInputText = ""
  )
  $certUtilPath = Join-Path $env:SystemRoot "System32\certutil.exe"
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $certUtilPath
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw ($Operation + " could not start.") }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not [string]::IsNullOrEmpty($StandardInputText)) {
      $process.StandardInput.Write($StandardInputText)
    }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(20000)) {
      try { $process.Kill($true) } catch { }
      $process.WaitForExit()
      $stdout = $stdoutTask.GetAwaiter().GetResult()
      $stderr = $stderrTask.GetAwaiter().GetResult()
      throw ($Operation + " timed out. stdout: " + $stdout + " stderr: " + $stderr)
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
      throw ($Operation + " failed with exit " + $process.ExitCode + ". stdout: " + $stdout + " stderr: " + $stderr)
    }
    return [pscustomobject]@{ ExitCode = $process.ExitCode; StdOut = $stdout; StdErr = $stderr }
  } finally {
    $process.Dispose()
  }
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

    foreach ($storeName in @("Root", "TrustedPublisher")) {
      if ((Get-CurrentUserCertificates -StoreName $storeName).Count -ne 0) {
        throw ("Refusing to overwrite an existing CurrentUser " + $storeName + " certificate.")
      }
    }

    # certutil may request confirmation when adding a root. Feed an explicit
    # affirmative response to the bounded child process; never leave an
    # interactive prompt waiting on a hosted runner.
    Invoke-BoundedCertUtil -Arguments @("-addstore", "-f", "-user", "Root", $CertificatePath) -Operation "Install temporary CurrentUser root certificate" -StandardInputText "y`n" | Out-Null
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
    $rootMatches = Get-CurrentUserCertificates -StoreName "Root"
    if ($rootMatches.Count -gt 0) {
      Invoke-BoundedCertUtil -Arguments @("-delstore", "-f", "-user", "Root", $Thumbprint) -Operation "Remove temporary CurrentUser root certificate" -StandardInputText "y`n" | Out-Null
    }
    if ((Get-CurrentUserCertificates -StoreName "Root").Count -ne 0) {
      throw "Temporary publisher cleanup failed in CurrentUser Root."
    }

    $publisherMatches = Get-CurrentUserCertificates -StoreName "TrustedPublisher"
    if ($publisherMatches.Count -gt 0) {
      $publisherStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
        [System.Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
      )
      try {
        $publisherStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        foreach ($entry in $publisherMatches) { $publisherStore.Remove($entry) }
      } finally {
        $publisherStore.Close()
      }
    }
    if ((Get-CurrentUserCertificates -StoreName "TrustedPublisher").Count -ne 0) {
      throw "Temporary publisher cleanup failed in CurrentUser TrustedPublisher."
    }
    Write-Output "Removed ephemeral publisher from CurrentUser Root and TrustedPublisher."
  }
} finally {
  if ($certificate) {
    $certificate.Dispose()
  }
}
