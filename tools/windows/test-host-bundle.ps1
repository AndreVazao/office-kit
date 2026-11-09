[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BundleDirectory
)

$ErrorActionPreference = "Stop"
$bundleRoot = (Resolve-Path $BundleDirectory).Path
$nodePath = Join-Path $bundleRoot "node.exe"
$helperPath = Join-Path $bundleRoot "OfficeKit.CngHost.exe"
$launcherPath = Join-Path $bundleRoot "office-kit-host.cmd"
$hostCommandTimeoutSeconds = 90

foreach ($required in @($nodePath, $helperPath, $launcherPath)) {
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

  $description = $Arguments -join " "
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = Join-Path $env:SystemRoot "System32\cmd.exe"
  $startInfo.WorkingDirectory = $bundleRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $command = '""' + $launcherPath + '" ' + ($Arguments -join " ") + '"'
  foreach ($argument in @("/d", "/s", "/c", $command)) {
    $null = $startInfo.ArgumentList.Add($argument)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    Write-Host ("Running portable host command: " + $description)
    if (-not $process.Start()) {
      throw ("Could not start portable host command: " + $description)
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($hostCommandTimeoutSeconds * 1000)) {
      try {
        $process.Kill($true)
      } catch {
        try { $process.Kill() } catch { }
        try { & taskkill.exe /PID $process.Id /T /F | Out-Null } catch { }
      }
      if (-not $process.WaitForExit(10000)) {
        try { & taskkill.exe /PID $process.Id /T /F | Out-Null } catch { }
        if (-not $process.WaitForExit(10000)) {
          throw ("Portable host process tree could not be stopped after timeout (" + $description + ").")
        }
      }
      $stdoutReady = $stdoutTask.Wait(10000)
      $stderrReady = $stderrTask.Wait(10000)
      if (-not $stdoutReady -or -not $stderrReady) {
        throw ("Portable host command timed out and redirected output did not close (" + $description + ").")
      }
      $stdout = $stdoutTask.GetAwaiter().GetResult()
      $stderr = $stderrTask.GetAwaiter().GetResult()
      throw (
        "Portable host command timed out after " + $hostCommandTimeoutSeconds +
        " seconds (" + $description + "). stdout: " + $stdout + " stderr: " + $stderr
      )
    }

    $stdoutReady = $stdoutTask.Wait(10000)
    $stderrReady = $stderrTask.Wait(10000)
    if (-not $stdoutReady -or -not $stderrReady) {
      throw ("Portable host process exited but redirected output did not close (" + $description + ").")
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
      throw (
        "Office Kit host command failed (" + $description + ", exit " +
        $process.ExitCode + "). stdout: " + $stdout + " stderr: " + $stderr
      )
    }
    try {
      return ($stdout | ConvertFrom-Json -ErrorAction Stop)
    } catch {
      throw ("Office Kit host returned invalid JSON (" + $description + "). stderr: " + $stderr)
    }
  } finally {
    $process.Dispose()
  }
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $testLocalAppData -Force | Out-Null
  Write-Host "Created isolated LocalAppData for the portable host test."

  $certificate = New-SelfSignedCertificate -Subject "CN=Office Kit CI Ephemeral Publisher" -Type CodeSigningCert -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256
  Write-Host "Created an ephemeral CI code-signing certificate."

  Write-Host "Exporting ephemeral publisher certificate."
  Export-Certificate -Cert $certificate -FilePath $certificateFile | Out-Null
  Write-Host "Adding ephemeral certificate to CurrentUser Root store."
  & certutil.exe -f -user -addstore Root $certificateFile
  if ($LASTEXITCODE -ne 0) { throw "Could not trust ephemeral certificate in CurrentUser Root store." }
  Write-Host "Adding ephemeral certificate to CurrentUser TrustedPublisher store."
  & certutil.exe -f -user -addstore TrustedPublisher $certificateFile
  if ($LASTEXITCODE -ne 0) { throw "Could not trust ephemeral certificate in CurrentUser TrustedPublisher store." }
  Write-Host "Trusted the ephemeral certificate only in CurrentUser stores."

  Write-Host "Signing the bundled CNG helper."
  $signature = Set-AuthenticodeSignature -FilePath $helperPath -Certificate $certificate -HashAlgorithm SHA256
  Write-Host ("CNG helper signature status: " + $signature.Status)
  if ($signature.Status -ne "Valid") {
    throw ("CI signing failed: " + $signature.Status + " " + $signature.StatusMessage)
  }
  Write-Host "Signed the bundled CNG helper with the ephemeral CI certificate."

  $env:LOCALAPPDATA = $testLocalAppData
  # The launcher must resolve the bundled helper itself; do not inject its path here.
  Remove-Item Env:OFFICE_KIT_CNG_HOST_PATH -ErrorAction SilentlyContinue
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
      & certutil.exe -f -user -delstore $store $certificate.Thumbprint | Out-Null
    }
  }

  $env:LOCALAPPDATA = $oldLocalAppData
  $env:OFFICE_KIT_CNG_HOST_PATH = $oldHelperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $oldThumbprint

  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
