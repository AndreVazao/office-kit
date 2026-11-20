[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BundleDirectory,
  [Parameter(Mandatory = $true)]
  [ValidateSet("DGM-MAT", "VST")]
  [string]$Edition
)

$ErrorActionPreference = "Stop"

function Invoke-BoundedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutMilliseconds
  )
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Edition bundle process could not start." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
      try { $process.Kill($true) } catch { }
      $process.WaitForExit()
      throw ("Edition bundle process timed out after " + $TimeoutMilliseconds + " ms.")
    }
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = $stdoutTask.GetAwaiter().GetResult()
      StdErr = $stderrTask.GetAwaiter().GetResult()
    }
  } finally {
    $process.Dispose()
  }
}

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
$manifestIdentityMismatch = ($manifest.edition -ne $Edition) -or ($manifest.editionKey -ne $expectedKey) -or ($manifest.entrypoint -ne $expectedEntrypoint) -or ($manifest.launcher -ne $expectedLauncher)
if ($manifestIdentityMismatch) {
  throw "Edition bundle manifest does not match the requested product."
}
$manifestPolicyMismatch = ($manifest.minimumNodeVersion -ne "22.5.0") -or ($manifest.nodeArchitecture -ne "x64") -or ($manifest.backendAutoConnect -ne $false) -or ($manifest.backendMode -ne "read-only")
if ($manifestPolicyMismatch) {
  throw "Edition bundle manifest violates the runtime or safe-default contract."
}

$nodePath = Join-Path $bundleRoot "node.exe"
$helperPath = Join-Path $bundleRoot "OfficeKit.CngHost.exe"
$launcherPath = Join-Path $bundleRoot $expectedLauncher
$entrypointPath = Join-Path $bundleRoot ($expectedEntrypoint.Replace("/", "\"))
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
if (@($manifest.sourceFiles).Count -ne @($manifest.sourceFiles | Sort-Object -Unique).Count) {
  throw "Edition bundle source allowlist contains duplicate paths."
}
$actualFiles = @(Get-ChildItem -LiteralPath $bundleRoot -File -Recurse |
  ForEach-Object {
    $relativePath = $_.FullName.Substring($bundleRoot.Length + 1).Replace("\", "/")
    if ($rootExtras -notcontains $relativePath) { $relativePath }
  } |
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

$containsDgmatModules = @($manifest.sourceFiles | Where-Object { $_ -match "(^|/)dgmat-" }).Count -gt 0
$containsVstModules = @($manifest.sourceFiles | Where-Object { $_ -match "(^|/)vst-" }).Count -gt 0
$expectedAdapter = if ($Edition -eq "DGM-MAT") { "dgm-mat" } else { "vazao-sovereign-trader" }
$expectedExcludedAdapter = if ($Edition -eq "DGM-MAT") { "VST" } else { "DGM-MAT" }
$actualAdapterAllowlist = @($manifest.adapterAllowlist)
$actualExcludedAdapters = @($manifest.excludedAdapters)
if ($actualAdapterAllowlist.Count -ne 1 -or $actualAdapterAllowlist[0] -ne $expectedAdapter) {
  throw "Edition bundle adapter allowlist does not match the selected edition."
}
if ($actualExcludedAdapters.Count -ne 1 -or $actualExcludedAdapters[0] -ne $expectedExcludedAdapter) {
  throw "Edition bundle excluded-adapter manifest does not match the selected edition."
}
if ($Edition -eq "DGM-MAT" -and $containsVstModules) {
  throw "DGM-MAT bundle contains VST-specific modules."
}
if ($Edition -eq "VST" -and $containsDgmatModules) {
  throw "VST bundle contains DGM-MAT-specific modules."
}

$certificate = $null
$rootStore = $null
$publisherStore = $null
$rootStoreOpened = $false
$publisherStoreOpened = $false
$oldHelperPath = $env:OFFICE_KIT_CNG_HOST_PATH
$oldThumbprint = $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT
$oldLocalAppData = $env:LOCALAPPDATA
$launcherDataRoot = Join-Path $env:TEMP ("OfficeKit-EditionLauncher-" + [guid]::NewGuid().ToString("N"))
$untrustedDataRoot = Join-Path $env:TEMP ("OfficeKit-EditionUntrusted-" + [guid]::NewGuid().ToString("N"))
$runnerPath = Join-Path $PSScriptRoot "edition-host-bundle-test-runner.mjs"

try {
  Write-Output "Edition bundle smoke: creating ephemeral publisher certificate."
  $certificate = New-SelfSignedCertificate -Subject ("CN=Office Kit Edition Bundle CI " + [guid]::NewGuid().ToString("N")) -Type CodeSigningCert -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256

  Write-Output "Edition bundle smoke: signing native CNG helper."
  # Do not inspect SignerCertificate or Status on the returned Authenticode
  # object: PowerShell may lazily invoke the Windows chain/revocation provider,
  # which can hang on an untrusted ephemeral certificate in hosted CI.
  # The production launcher is the authoritative verifier below: first it must
  # reject this signer while untrusted, then accept it only after the test adds
  # this exact ephemeral certificate to the disposable runner's trust stores.
  Set-AuthenticodeSignature -FilePath $helperPath -Certificate $certificate -HashAlgorithm SHA256 | Out-Null
  Write-Output "Edition bundle smoke: signing command completed; launcher will verify signature and trust."

  if ($env:GITHUB_ACTIONS -ne "true") {
    throw "Trusted-publisher smoke tests may only modify the disposable GitHub Actions runner user stores."
  }

  # Prove that the production host rejects this signer before any trust is granted.
  $env:OFFICE_KIT_CNG_HOST_PATH = $helperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint
  New-Item -ItemType Directory -Path $untrustedDataRoot -Force | Out-Null
  $env:LOCALAPPDATA = $untrustedDataRoot
  $untrustedRun = Invoke-BoundedProcess -FilePath $env:ComSpec -Arguments @("/d", "/c", $launcherPath, "health") -TimeoutMilliseconds 30000
  if ($untrustedRun.ExitCode -eq 0) {
    throw "Edition launcher accepted an untrusted publisher."
  }
  $untrustedResult = ($untrustedRun.StdOut.Trim() | ConvertFrom-Json)
  if ($untrustedResult.ok -ne $false -or $untrustedResult.error -ne "host_start_failed") {
    throw "Untrusted publisher rejection did not produce the expected sanitized startup failure."
  }

  # The production host must reject an untrusted signer. After proving that boundary,
  # trust this one ephemeral certificate in CurrentUser stores only so the host can
  # complete its real CNG/SQLite startup path. The certificate is removed in finally.
  $rootStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  $publisherStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  $rootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  $rootStoreOpened = $true
  $publisherStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  $publisherStoreOpened = $true
  $rootStore.Add($certificate)
  $publisherStore.Add($certificate)
  # The next real launcher invocation is the authoritative trust check.
  # It exercises the same production verification path without an unbounded
  # PowerShell Authenticode provider call in the test harness.
  Write-Output "Edition bundle smoke: ephemeral publisher installed in CurrentUser trust stores."

  $env:OFFICE_KIT_CNG_HOST_PATH = $helperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint
  New-Item -ItemType Directory -Path $launcherDataRoot -Force | Out-Null
  $env:LOCALAPPDATA = $launcherDataRoot
  Write-Output "Edition bundle smoke: executing shipped launcher health check."
  $launcherRun = Invoke-BoundedProcess -FilePath $env:ComSpec -Arguments @("/d", "/c", $launcherPath, "health") -TimeoutMilliseconds 30000
  if ($launcherRun.ExitCode -ne 0) {
    throw ("Edition launcher health smoke test failed (exit " + $launcherRun.ExitCode + "). stdout: " + $launcherRun.StdOut + " stderr: " + $launcherRun.StdErr)
  }
  $launcherResult = ($launcherRun.StdOut.Trim() | ConvertFrom-Json)
  $launcherMismatch = ($launcherResult.ok -ne $true) -or ($launcherResult.health.edition -ne $expectedKey) -or ($launcherResult.health.adapterConnected -ne $false)
  if ($launcherMismatch) {
    throw "Edition launcher did not start disconnected with the expected edition identity."
  }
  Write-Output "Edition bundle smoke: executing JSON-lines test runner."
  $runnerRun = Invoke-BoundedProcess -FilePath $nodePath -Arguments @($runnerPath, $bundleRoot, $Edition) -TimeoutMilliseconds 90000
  if ($runnerRun.ExitCode -ne 0) {
    throw ("Edition bundle CLI smoke test failed (exit " + $runnerRun.ExitCode + "). stdout: " + $runnerRun.StdOut + " stderr: " + $runnerRun.StdErr)
  }
  $runnerResult = ($runnerRun.StdOut.Trim() | ConvertFrom-Json)
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
  Write-Output "Edition bundle smoke: removing temporary profile and CI signing certificate."
  if (Test-Path -LiteralPath $untrustedDataRoot) {
    Remove-Item -LiteralPath $untrustedDataRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($certificate -and $rootStore -and $rootStoreOpened) {
    try {
      $trustedRoots = $rootStore.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $certificate.Thumbprint,
        $false
      )
      foreach ($trustedCertificate in $trustedRoots) { $rootStore.Remove($trustedCertificate) }
      $remainingRoots = $rootStore.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $certificate.Thumbprint,
        $false
      )
      if ($remainingRoots.Count -ne 0) { throw "Temporary CI root certificate cleanup failed." }
    } finally {
      $rootStore.Close()
    }
  }
  if ($certificate -and $publisherStore -and $publisherStoreOpened) {
    try {
      $trustedPublishers = $publisherStore.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $certificate.Thumbprint,
        $false
      )
      foreach ($trustedCertificate in $trustedPublishers) { $publisherStore.Remove($trustedCertificate) }
      $remainingPublishers = $publisherStore.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $certificate.Thumbprint,
        $false
      )
      if ($remainingPublishers.Count -ne 0) { throw "Temporary CI publisher certificate cleanup failed." }
    } finally {
      $publisherStore.Close()
    }
  }
  if ($certificate) {
    Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $certificate.Thumbprint) -Force -ErrorAction SilentlyContinue
  }
}
