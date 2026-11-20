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
$oldHelperPath = $env:OFFICE_KIT_CNG_HOST_PATH
$oldThumbprint = $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT
$oldLocalAppData = $env:LOCALAPPDATA
$untrustedDataRoot = Join-Path $env:TEMP ("OfficeKit-EditionUntrusted-" + [guid]::NewGuid().ToString("N"))
$pinnedMismatchDataRoot = Join-Path $env:TEMP ("OfficeKit-EditionPinnedMismatch-" + [guid]::NewGuid().ToString("N"))
$postTestDataRoot = Join-Path $env:TEMP ("OfficeKit-EditionPostTest-" + [guid]::NewGuid().ToString("N"))
$runnerPath = Join-Path $PSScriptRoot "edition-host-bundle-test-runner.mjs"

try {
  Write-Output "Edition bundle smoke: creating ephemeral publisher certificate."
  $certificate = New-SelfSignedCertificate -Subject ("CN=Office Kit Edition Bundle CI " + [guid]::NewGuid().ToString("N")) -Type CodeSigningCert -CertStoreLocation "Cert:\CurrentUser\My" -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256

  Write-Output "Edition bundle smoke: signing native CNG helper."
  Set-AuthenticodeSignature -FilePath $helperPath -Certificate $certificate -HashAlgorithm SHA256 | Out-Null
  Write-Output "Edition bundle smoke: signature created; no Windows trust store will be modified."

  if ($env:GITHUB_ACTIONS -ne "true") {
    throw "Edition bundle signature smoke tests may only run in the disposable GitHub Actions runner."
  }

  $env:OFFICE_KIT_CNG_HOST_PATH = $helperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint

  New-Item -ItemType Directory -Path $untrustedDataRoot -Force | Out-Null
  $env:LOCALAPPDATA = $untrustedDataRoot
  Write-Output "Edition bundle smoke: production launcher must reject the untrusted ephemeral publisher."
  $untrustedRun = Invoke-BoundedProcess -FilePath $env:ComSpec -Arguments @("/d", "/c", $launcherPath, "health") -TimeoutMilliseconds 30000
  if ($untrustedRun.ExitCode -eq 0) {
    throw "Edition launcher accepted an untrusted publisher."
  }
  $untrustedResult = ($untrustedRun.StdOut.Trim() | ConvertFrom-Json)
  if ($untrustedResult.ok -ne $false -or $untrustedResult.error -ne "host_start_failed") {
    throw "Untrusted publisher rejection did not produce the expected sanitized startup failure."
  }

  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = ("0" * 40)
  New-Item -ItemType Directory -Path $pinnedMismatchDataRoot -Force | Out-Null
  $env:LOCALAPPDATA = $pinnedMismatchDataRoot
  Write-Output "Edition bundle smoke: production launcher must reject a signer thumbprint mismatch."
  $pinnedMismatchRun = Invoke-BoundedProcess -FilePath $env:ComSpec -Arguments @("/d", "/c", $launcherPath, "health") -TimeoutMilliseconds 30000
  if ($pinnedMismatchRun.ExitCode -eq 0) {
    throw "Edition launcher accepted a signer that does not match the pinned publisher thumbprint."
  }
  $pinnedMismatchResult = ($pinnedMismatchRun.StdOut.Trim() | ConvertFrom-Json)
  if ($pinnedMismatchResult.ok -ne $false -or $pinnedMismatchResult.error -ne "host_start_failed") {
    throw "Pinned publisher mismatch did not produce the expected sanitized startup failure."
  }

  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $certificate.Thumbprint
  Write-Output "Edition bundle smoke: exercising the bundled host and JSON-lines CLI with test-only signature-integrity verification."
  $runnerRun = Invoke-BoundedProcess -FilePath $nodePath -Arguments @($runnerPath, $bundleRoot, $Edition) -TimeoutMilliseconds 90000
  if ($runnerRun.ExitCode -ne 0) {
    throw ("Edition bundle CLI smoke test failed (exit " + $runnerRun.ExitCode + "). stdout: " + $runnerRun.StdOut + " stderr: " + $runnerRun.StdErr)
  }
  $runnerResult = ($runnerRun.StdOut.Trim() | ConvertFrom-Json)
  if ($runnerResult.status -ne "passed" -or $runnerResult.edition -ne $Edition
    -or $runnerResult.helperSignatureIntegrity -ne $true
    -or $runnerResult.helperPublisherThumbprintPinned -ne $true
    -or $runnerResult.certificateChainTrust -ne "not-established-by-this-test"
    -or $runnerResult.productionAuthenticodePolicyExercised -ne $false) {
    throw "Edition bundle test runner did not report the explicit test-only signature boundary."
  }

  New-Item -ItemType Directory -Path $postTestDataRoot -Force | Out-Null
  $env:LOCALAPPDATA = $postTestDataRoot
  Write-Output "Edition bundle smoke: production launcher must still reject the publisher; test did not add root trust."
  $postTestRun = Invoke-BoundedProcess -FilePath $env:ComSpec -Arguments @("/d", "/c", $launcherPath, "health") -TimeoutMilliseconds 30000
  if ($postTestRun.ExitCode -eq 0) {
    throw "Production launcher accepted the ephemeral publisher after the test-only host run."
  }
  $postTestResult = ($postTestRun.StdOut.Trim() | ConvertFrom-Json)
  if ($postTestResult.ok -ne $false -or $postTestResult.error -ne "host_start_failed") {
    throw "Production launcher rejection after the test-only run was not sanitized."
  }

  Write-Output ("Portable " + $Edition + " Windows bundle passed content-isolation and test-only host/CLI integration.")
} finally {
  $env:OFFICE_KIT_CNG_HOST_PATH = $oldHelperPath
  $env:OFFICE_KIT_CNG_SIGNER_THUMBPRINT = $oldThumbprint
  $env:LOCALAPPDATA = $oldLocalAppData
  foreach ($dataRoot in @($untrustedDataRoot, $pinnedMismatchDataRoot, $postTestDataRoot)) {
    if (Test-Path -LiteralPath $dataRoot) {
      Remove-Item -LiteralPath $dataRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if ($certificate) {
    try {
      Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $certificate.Thumbprint) -Force -ErrorAction Stop
      if (Test-Path -LiteralPath ("Cert:\CurrentUser\My\" + $certificate.Thumbprint)) {
        throw "Temporary CI signing certificate remains in CurrentUser My."
      }
    } finally {
      $certificate.Dispose()
    }
  }
}
