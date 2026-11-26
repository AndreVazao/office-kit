[CmdletBinding()]
param(
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "win-x64",
    [string]$OutputDirectory = (Join-Path $env:TEMP "OfficeKit-Msix-Prototype")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
    throw "MSIX prototype packaging must run on Windows."
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$project = Join-Path $repositoryRoot "native\windows\OfficeKit.Bootstrapper\OfficeKit.Bootstrapper.csproj"
$manifest = Join-Path $PSScriptRoot "AppxManifest.xml"
if (-not (Test-Path -LiteralPath $project -PathType Leaf)) { throw "Bootstrapper project not found." }
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "MSIX manifest not found." }

$windowsKits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
if (-not (Test-Path -LiteralPath $windowsKits -PathType Container)) {
    throw "Windows 10/11 SDK not found; MakeAppx.exe is required."
}
$makeAppx = Get-ChildItem -LiteralPath $windowsKits -Filter "MakeAppx.exe" -File -Recurse |
    Where-Object { $_.FullName -match "[\\/]x64[\\/]MakeAppx\.exe$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if ($null -eq $makeAppx) { throw "x64 MakeAppx.exe was not found in the Windows SDK." }

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
$stage = Join-Path $output "package"
$app = Join-Path $stage "OfficeKit.Bootstrapper.exe"
$assets = Join-Path $stage "Assets"
New-Item -ItemType Directory -Path $assets -Force | Out-Null

& dotnet publish $project --configuration $Configuration --runtime $RuntimeIdentifier --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true --output $stage
if ($LASTEXITCODE -ne 0) { throw "Self-contained bootstrapper publish failed." }
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Published bootstrapper executable is missing." }

Copy-Item -LiteralPath $manifest -Destination (Join-Path $stage "AppxManifest.xml")
Add-Type -AssemblyName System.Drawing
function New-PrototypeLogo([string]$Path, [int]$Size) {
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(23, 50, 77))
            $fontSize = [Math]::Max(9, [int]($Size * 0.30))
            $font = [System.Drawing.Font]::new("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)
            try {
                $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
                try {
                    $format = [System.Drawing.StringFormat]::new()
                    try {
                        $format.Alignment = [System.Drawing.StringAlignment]::Center
                        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
                        $graphics.DrawString("OK", $font, $brush, [System.Drawing.RectangleF]::new(0, 0, $Size, $Size), $format)
                    } finally { $format.Dispose() }
                } finally { $brush.Dispose() }
            } finally { $font.Dispose() }
        } finally { $graphics.Dispose() }
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
}
New-PrototypeLogo (Join-Path $assets "StoreLogo.png") 50
New-PrototypeLogo (Join-Path $assets "Square150x150Logo.png") 150
New-PrototypeLogo (Join-Path $assets "Square44x44Logo.png") 44

$packagePath = Join-Path $output "OfficeKit.BootstrapperPrototype-unsigned.msix"
& $makeAppx.FullName pack /d $stage /p $packagePath /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx package creation failed." }

& $makeAppx.FullName validate /p $packagePath
if ($LASTEXITCODE -ne 0) { throw "MakeAppx package validation failed." }

$verification = Join-Path $output "verification"
& $makeAppx.FullName unpack /p $packagePath /d $verification /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx package unpack verification failed." }

$verifiedManifestPath = Join-Path $verification "AppxManifest.xml"
$verifiedExecutable = Join-Path $verification "OfficeKit.Bootstrapper.exe"
$verifiedBlockMap = Join-Path $verification "AppxBlockMap.xml"
foreach ($required in @($verifiedManifestPath, $verifiedExecutable, $verifiedBlockMap)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "MSIX verification output is missing required file: $required"
    }
}

[xml]$verifiedManifest = Get-Content -LiteralPath $verifiedManifestPath -Raw
$manifestNs = [System.Xml.XmlNamespaceManager]::new($verifiedManifest.NameTable)
$manifestNs.AddNamespace("f", "http://schemas.microsoft.com/appx/manifest/foundation/windows10")
$manifestNs.AddNamespace("uap10", "http://schemas.microsoft.com/appx/manifest/uap/windows10/10")
$integrity = $verifiedManifest.SelectSingleNode("/f:Package/f:Properties/uap10:PackageIntegrity/uap10:Content", $manifestNs)
$application = $verifiedManifest.SelectSingleNode("/f:Package/f:Applications/f:Application", $manifestNs)
if ($null -eq $integrity -or $integrity.GetAttribute("Enforcement") -ne "on") {
    throw "PICE enforcement is not enabled in the packed manifest."
}
if ($null -eq $application -or $application.GetAttribute("Executable") -ne "OfficeKit.Bootstrapper.exe") {
    throw "Packed manifest does not declare the expected bootstrapper entry point."
}

[pscustomobject]@{
    package = $packagePath
    signed = $false
    installableAsTrustedPackage = $false
    packageValidated = $true
    packageUnpackedAndInspected = $true
    packageIntegrityEnforcement = "on"
    entryPoint = "OfficeKit.Bootstrapper.exe"
    publisher = "CN=Office Kit Prototype Only"
} | ConvertTo-Json -Depth 3
