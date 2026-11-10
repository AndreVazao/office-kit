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
$hostCommandTimeoutSeconds = 45

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

function Invoke-BoundedNative {
  param(
    [string]$FileName,
    [string[]]$NativeArguments,
    [string]$Description,
    [int]$TimeoutMilliseconds = 20000
  )

  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FileName
  $info.WorkingDirectory = $bundleRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in $NativeArguments) {
    $null = $info.ArgumentList.Add($argument)
  }
  $native = [System.Diagnostics.Process]::new()
  $native.StartInfo = $info
  try {
    Write-Host ("Running bounded native command: " + $Description)
    if (-not $native.Start()) { throw ("Could not start native command: " + $Description) }
    $stdoutTask = $native.StandardOutput.ReadToEndAsync()
    $stderrTask = $native.StandardError.ReadToEndAsync()
    if (-not $native.WaitForExit($TimeoutMilliseconds)) {
      try { $native.Kill() } catch { }
      if (-not $native.WaitForExit(5000)) {
        throw ("Native command could not be stopped after timeout: " + $Description)
      }
      $stdout = if ($stdoutTask.IsCompleted) { $stdoutTask.GetAwaiter().GetResult() } else { "" }
      $stderr = if ($stderrTask.IsCompleted) { $stderrTask.GetAwaiter().GetResult() } else { "" }
      throw ("Native command timed out: " + $Description + ". stdout: " + $stdout + " stderr: " + $stderr)
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($native.ExitCode -ne 0) {
      throw ("Native command failed (" + $Description + ", exit " + $native.ExitCode + "). stdout: " + $stdout + " stderr: " + $stderr)
    }
    return $stdout
  } finally {
    $native.Dispose()
  }
}

function Invoke-PortableHostRunner {
  param([string[]]$Arguments)
  $runnerPath = Join-Path $bundleRoot "portable-host-test-runner.mjs"
  $stdout = Invoke-BoundedNative -FileName $nodePath -NativeArguments (@($runnerPath) + $Arguments) -Description ("portable host test " + ($Arguments -join " ")) -TimeoutMilliseconds 45000
  try { return ($stdout | ConvertFrom-Json -ErrorAction Stop) }
  catch { throw ("Portable host test runner returned invalid JSON. stdout: " + $stdout) }
}

function Invoke-OfficeKitHost {
  param(
    [string[]]$Arguments,
    [switch]$ExpectFailure
  )

  $description = $Arguments -join " "
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = Join-Path $env:SystemRoot "System32\cmd.exe"
  $startInfo.WorkingDirectory = $bundleRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $stdoutPath = Join-Path $tempRoot ("host-" + [guid]::NewGuid().ToString("N") + ".stdout.txt")
  $stderrPath = Join-Path $tempRoot ("host-" + [guid]::NewGuid().ToString("N") + ".stderr.txt")
  $startInfo.RedirectStandardOutput = $false
  $startInfo.RedirectStandardError = $false
  $command = '""' + $launcherPath + '" ' + ($Arguments -join " ") +
    ' 1> "' + $stdoutPath + '" 2> "' + $stderrPath + '""'
  $startInfo.Arguments = "/d /s /c " + $command

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    Write-Host ("Running portable host command: " + $description)
    if (-not $process.Start()) {
      throw ("Could not start portable host command: " + $description)
    }

    if (-not $process.WaitForExit($hostCommandTimeoutSeconds * 1000)) {
      try { $process.Kill($true) } catch { }
      if (-not $process.WaitForExit(10000)) {
        try { & taskkill.exe /PID $process.Id /T /F | Out-Null } catch { }
        if (-not $process.WaitForExit(10000)) {
          throw ("Portable host process tree could not be stopped after timeout (" + $description + ").")
        }
      }
      $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
      throw (
        "Portable host command timed out after " + $hostCommandTimeoutSeconds +
        " seconds (" + $description + "). stdout: " + $stdout + " stderr: " + $stderr
      )
    }

    $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
    if ($process.ExitCode -ne 0) {
      if ($ExpectFailure) {
        try { return ($stdout | ConvertFrom-Json -ErrorAction Stop) }
        catch { throw ("Expected launcher rejection returned invalid JSON. stdout: " + $stdout + " stderr: " + $stderr) }
      }
      throw (
        "Office Kit host command failed (" + $description + ", exit " +
        $process.ExitCode + "). stdout: " + $stdout + " stderr: " + $stderr
      )
    }
    if ($ExpectFailure) {
      throw "Portable host launcher unexpectedly accepted an untrusted CI certificate."
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

  Write-Host "Leaving the ephemeral certificate untrusted; production launcher must reject this CI-only signer."

  Write-Host "Signing the bundled CNG helper."
  $escapedHelperPath = $helperPath.Replace("'", "''")
  $signingScript = @"
`$moduleRoot = Join-Path `$env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'
`$env:PSModulePath = `$moduleRoot + ';' + `$env:PSModulePath
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
`$cert = Get-Item -LiteralPath 'Cert:\CurrentUser\My\`$($certificate.Thumbprint)'
`$signature = Set-AuthenticodeSignature -FilePath '$escapedHelperPath' -Certificate `$cert -HashAlgorithm SHA256
if (`$signature.Status -ne 'Valid') { exit 5 }
"@
  $signingCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($signingScript))
  Invoke-BoundedNative -FileName "powershell.exe" -NativeArguments @(
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $signingCommand
  ) -Description "sign bundled CNG helper" -TimeoutMilliseconds 20000
  Write-Host "Signed the bundled CNG helper with the ephemeral CI certificate."

  $env:LOCALAPPDATA = $testLocalAppData
  # The launcher must resolve the bundled helper itself; do not inject its path here.
  Remove-Item Env:OFFICE_KIT_CNG_HOST_PATH -ErrorAction SilentlyContinue
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint

  $launcherRejection = Invoke-OfficeKitHost -Arguments @("health") -ExpectFailure
  if ($launcherRejection.status -ne "error" -or $launcherRejection.code -ne "windows_host_command_failed_powershell") {
    throw "Production launcher did not reject the untrusted ephemeral CI certificate."
  }

  $env:OFFICE_KIT_CNG_HOST_PATH = $helperPath
  $runnerPath = Join-Path $bundleRoot "portable-host-test-runner.mjs"
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "portable-host-test-runner.mjs") -Destination $runnerPath

  $signature = Invoke-PortableHostRunner -Arguments @("verify-signature")
  if ($signature.status -ne "signature_verified" -or $signature.trustStatus -ne "NotTrusted") {
    throw "The test-only signature integrity verifier did not observe the expected untrusted chain."
  }

  $initial = Invoke-PortableHostRunner -Arguments @("health")
  if ($initial.status -ne "ready" -or $initial.identityStatus -ne "empty") {
    throw "First portable host start did not report a clean empty identity state."
  }

  $created = Invoke-PortableHostRunner -Arguments @(
    "create-identity",
    "--organization-id=office-kit-ci",
    "--node-id=windows-portable-host-ci"
  )
  if ($created.status -ne "created" -or $created.generation -ne 1) {
    throw "Portable host identity creation failed."
  }

  $reopened = Invoke-PortableHostRunner -Arguments @("health")
  if ($reopened.status -ne "ready" -or $reopened.identityStatus -ne "active" -or $reopened.identity.generation -ne 1) {
    throw "Portable host did not recover the identity in a fresh process."
  }

  $rotated = Invoke-PortableHostRunner -Arguments @("rotate-identity")
  if ($rotated.status -ne "rotated" -or $rotated.generation -ne 2) {
    throw "Portable host identity rotation failed."
  }

  $revoked = Invoke-PortableHostRunner -Arguments @("revoke-identity")
  if ($revoked.status -ne "revoked") {
    throw "Portable host identity revocation failed."
  }

  $finalHealth = Invoke-PortableHostRunner -Arguments @("health")
  if ($finalHealth.status -ne "ready" -or $finalHealth.identityStatus -ne "revoked" -or $null -ne $finalHealth.identity) {
    throw "Portable host did not report the revoked identity state after process restart."
  }

  Write-Output "Portable Windows host bundle passed: launcher rejected untrusted signer; test-only pinned signature integrity, real local SQLite and Windows CNG identity create/reopen/rotate/revoke passed. Trusted-publisher acceptance remains a physical-release validation."
}
finally {
  $officeKitData = Join-Path $testLocalAppData "OfficeKit"
  if (Test-Path -LiteralPath $officeKitData) {
    & icacls.exe $officeKitData /reset /T /C | Out-Null
  }

  if ($null -ne $certificate) {
    try { Invoke-BoundedNative -FileName "certutil.exe" -NativeArguments @("-silent", "-f", "-user", "-delstore", "My", $certificate.Thumbprint) -Description "remove ephemeral CurrentUser My certificate" } catch { }
  }

  $env:LOCALAPPDATA = $oldLocalAppData
  $env:OFFICE_KIT_CNG_HOST_PATH = $oldHelperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $oldThumbprint

  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
