[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$identityName = "AndreVazao.OfficeKit.BootstrapperPrototype"
$publisher = "CN=Office Kit Prototype Only"
$packagePath = (Resolve-Path -LiteralPath $PackagePath).Path
$existingPackage = Get-AppxPackage -Name $identityName -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $existingPackage) {
    throw "prototype_package_already_installed"
}

$certificate = $null
$certificateFile = Join-Path $env:TEMP ("OfficeKit-Msix-Prototype-" + [Guid]::NewGuid().ToString("N") + ".cer")
$packageFamilyName = $null
$packageLocalState = $null
$packageInstalled = $false
$packageActivated = $false
$certificateTrusted = $false

try {
    $certificateParameters = @{
        Type = "Custom"
        Subject = $publisher
        KeyAlgorithm = "RSA"
        KeyLength = 2048
        HashAlgorithm = "SHA256"
        KeyUsage = "DigitalSignature"
        CertStoreLocation = "Cert:\CurrentUser\My"
        TextExtension = @(
            "2.5.29.37={text}1.3.6.1.5.5.7.3.3",
            "2.5.29.19={text}"
        )
        NotAfter = (Get-Date).AddDays(2)
    }
    $certificate = New-SelfSignedCertificate @certificateParameters

    if ($certificate.Subject -cne $publisher) {
        throw "prototype_signing_certificate_subject_mismatch"
    }

    Export-Certificate -Cert $certificate -FilePath $certificateFile -Force | Out-Null
    Import-Certificate -FilePath $certificateFile -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
    $certificateTrusted = $true

    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $windowsKits = Join-Path $programFilesX86 "Windows Kits\10\bin"
    if (-not (Test-Path -LiteralPath $windowsKits -PathType Container)) {
        throw "windows_sdk_not_found_for_msix_signing"
    }

    $signTool = Get-ChildItem -LiteralPath $windowsKits -Filter "signtool.exe" -File -Recurse |
        Where-Object { $_.FullName -match "[\\/]x64[\\/]signtool\.exe$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($null -eq $signTool) {
        throw "x64_signtool_not_found"
    }

    & $signTool.FullName sign /fd SHA256 /sha1 $certificate.Thumbprint /s My /v $packagePath
    if ($LASTEXITCODE -ne 0) {
        throw "prototype_msix_signing_failed"
    }

    Add-AppxPackage -Path $packagePath -ErrorAction Stop
    $installed = Get-AppxPackage -Name $identityName -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $installed) {
        throw "prototype_msix_install_not_registered"
    }
    if ($installed.Publisher -cne $publisher) {
        throw "prototype_msix_installed_publisher_mismatch"
    }

    $packageInstalled = $true

    # PICE adds a Process Trust Label ACE to the installed package directory.
    # Inspect the installed ACL and verify that this ordinary CI process cannot
    # even acquire a write handle to a protected package executable. This is an
    # access-control proof, not a runtime hash-tamper/remediation proof.
    $systemRoot = [Environment]::GetEnvironmentVariable("SystemRoot")
    if ([string]::IsNullOrWhiteSpace($systemRoot)) {
        throw "prototype_msix_system_root_unavailable_for_acl_inspection"
    }
    $icacls = Join-Path $systemRoot "System32\\icacls.exe"
    if (-not (Test-Path -LiteralPath $icacls -PathType Leaf)) {
        throw "prototype_msix_icacls_missing"
    }
    $aclOutput = (& $icacls $installed.InstallLocation 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "prototype_msix_package_acl_query_failed"
    }
    if ($aclOutput -notmatch "S-1-19-512-4096") {
        throw "prototype_msix_process_trust_label_ace_missing"
    }

    $protectedExecutable = Join-Path $installed.InstallLocation "OfficeKit.Bootstrapper.exe"
    if (-not (Test-Path -LiteralPath $protectedExecutable -PathType Leaf)) {
        throw "prototype_msix_installed_executable_missing"
    }
    $writeHandleDenied = $false
    try {
        $probeHandle = [System.IO.File]::Open(
            $protectedExecutable,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::Read
        )
        $probeHandle.Dispose()
    }
    catch [System.UnauthorizedAccessException] {
        $writeHandleDenied = $true
    }
    catch [System.IO.IOException] {
        if ($_.Exception.HResult -eq -2147024891) {
            $writeHandleDenied = $true
        } else {
            throw
        }
    }
    if (-not $writeHandleDenied) {
        throw "prototype_msix_package_executable_write_access_not_denied"
    }

    $packageFamilyName = [string]$installed.PackageFamilyName
    if ([string]::IsNullOrWhiteSpace($packageFamilyName)) {
        throw "prototype_msix_package_family_missing"
    }

    $packageLocalState = Join-Path $env:LOCALAPPDATA "Packages\$packageFamilyName\LocalState"
    if (Test-Path -LiteralPath $packageLocalState -PathType Container) {
        Get-ChildItem -LiteralPath $packageLocalState -Filter "bootstrap-probe-*.json" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction Stop
    }

    $activationId = "$packageFamilyName!OfficeKitBootstrapper"
    $explorer = Join-Path $env:SystemRoot "explorer.exe"
    if (-not (Test-Path -LiteralPath $explorer -PathType Leaf)) {
        throw "windows_shell_activation_host_missing"
    }

    Start-Process -FilePath $explorer -ArgumentList @("shell:AppsFolder\$activationId") | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $marker = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $packageLocalState -PathType Container) {
            $marker = Get-ChildItem -LiteralPath $packageLocalState -Filter "bootstrap-probe-*.json" -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTimeUtc -Descending |
                Select-Object -First 1
        }
        if ($null -ne $marker) {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if ($null -eq $marker) {
        throw "prototype_msix_os_activation_marker_timeout"
    }

    $probe = Get-Content -LiteralPath $marker.FullName -Raw | ConvertFrom-Json
    if ($probe.ok -ne $true -or $probe.probeOnly -ne $true) {
        throw "prototype_msix_activation_probe_failed"
    }
    if ($probe.packageIdentityStatus -ne "packaged") {
        throw "prototype_msix_activation_missing_package_identity"
    }
    if ($probe.packageFullName -cne $installed.PackageFullName) {
        throw "prototype_msix_activation_full_name_mismatch"
    }
    if ($probe.packageFamilyName -cne $packageFamilyName) {
        throw "prototype_msix_activation_family_name_mismatch"
    }
    if ($probe.environmentAuthorityUsed -ne $false) {
        throw "prototype_msix_activation_used_environment_authority"
    }
    if ([int]$probe.processId -le 0) {
        throw "prototype_msix_activation_process_id_invalid"
    }

    $expectedSystemDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot "System32"))
    $actualSystemDirectory = [System.IO.Path]::GetFullPath([string]$probe.systemDirectory)
    if (-not [string]::Equals($actualSystemDirectory, $expectedSystemDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "prototype_msix_activation_system_directory_mismatch"
    }

    $installedManifestPath = Join-Path $installed.InstallLocation "AppxManifest.xml"
    if (-not (Test-Path -LiteralPath $installedManifestPath -PathType Leaf)) {
        throw "prototype_msix_installed_manifest_missing"
    }

    [xml]$installedManifest = Get-Content -LiteralPath $installedManifestPath -Raw
    $namespace = [System.Xml.XmlNamespaceManager]::new($installedManifest.NameTable)
    $namespace.AddNamespace("f", "http://schemas.microsoft.com/appx/manifest/foundation/windows10")
    $namespace.AddNamespace("uap10", "http://schemas.microsoft.com/appx/manifest/uap/windows10/10")
    $integrity = $installedManifest.SelectSingleNode(
        "/f:Package/f:Properties/uap10:PackageIntegrity/uap10:Content",
        $namespace
    )
    if ($null -eq $integrity -or $integrity.GetAttribute("Enforcement") -ne "on") {
        throw "prototype_msix_installed_manifest_pice_not_enabled"
    }

    $packageActivated = $true
    [pscustomobject]@{
        packageName = $identityName
        publisher = $publisher
        signingCertificate = "ephemeral-self-signed-ci-only"
        packageSigned = $true
        packageInstalled = $packageInstalled
        packageActivatedByWindowsShell = $packageActivated
        packageIdentityVerified = $true
        systemDirectoryVerifiedFromPackagedProcess = $true
        packageIntegrityEnforcementDeclared = "on"
        processTrustLabelAceVerified = $true
        packageExecutableWriteAccessDenied = $true
        runtimeTamperBlockingVerified = $false
        productionPublisherTrustVerified = $false
    } | ConvertTo-Json -Depth 3
}
finally {
    $registered = Get-AppxPackage -Name $identityName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $registered) {
        Remove-AppxPackage -Package $registered.PackageFullName -ErrorAction Stop
    } elseif ($packageInstalled) {
        throw "prototype_msix_uninstall_state_unexpected"
    }

    if ($null -ne $packageLocalState -and (Test-Path -LiteralPath $packageLocalState -PathType Container)) {
        Get-ChildItem -LiteralPath $packageLocalState -Filter "bootstrap-probe-*.json" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction Stop
    }

    if ($null -ne $certificate) {
        $trustedCertificatePath = "Cert:\LocalMachine\TrustedPeople\$($certificate.Thumbprint)"
        $personalCertificatePath = "Cert:\CurrentUser\My\$($certificate.Thumbprint)"
        if (Test-Path -LiteralPath $trustedCertificatePath) {
            Remove-Item -LiteralPath $trustedCertificatePath -Force -ErrorAction Stop
        }
        if (Test-Path -LiteralPath $personalCertificatePath) {
            Remove-Item -LiteralPath $personalCertificatePath -Force -ErrorAction Stop
        }
    }

    if (Test-Path -LiteralPath $certificateFile -PathType Leaf) {
        Remove-Item -LiteralPath $certificateFile -Force -ErrorAction Stop
    }

    $remainingPackage = Get-AppxPackage -Name $identityName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $remainingPackage) {
        throw "prototype_msix_uninstall_not_completed"
    }
    if ($certificateTrusted -and $null -ne $certificate) {
        $remainingTrust = Get-Item -LiteralPath "Cert:\LocalMachine\TrustedPeople\$($certificate.Thumbprint)" -ErrorAction SilentlyContinue
        if ($null -ne $remainingTrust) {
            throw "prototype_signing_certificate_trust_cleanup_failed"
        }
    }
}
