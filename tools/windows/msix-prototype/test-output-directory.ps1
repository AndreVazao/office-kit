$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$modulePath = Join-Path $PSScriptRoot "OutputDirectory.psm1"
Import-Module -Name $modulePath -Force -ErrorAction Stop
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("OfficeKit-Msix-OutputDirectory-Test-" + [Guid]::NewGuid().ToString("N"))
$repositoryRoot = Join-Path $testRoot "repository"
New-Item -ItemType Directory -Path $repositoryRoot -Force | Out-Null
function Assert-Throws([scriptblock]$Action, [string]$ExpectedCode) {
    $caught = $false
    try { & $Action } catch {
        if ($_.Exception.Message -notlike "*$ExpectedCode*") { throw }
        $caught = $true
    }
    if (-not $caught) { throw "Expected exception was not thrown: $ExpectedCode" }
}
try {
    $newOutput = Join-Path $testRoot "new-output"
    $created = Initialize-OfficeKitOutputDirectory -Path $newOutput -RepositoryRoot $repositoryRoot
    if ($created -ne [System.IO.Path]::GetFullPath($newOutput)) { throw "new output path was not normalized" }
    if (-not (Test-Path -LiteralPath $newOutput -PathType Container)) { throw "new output directory was not created" }
    $emptyOutput = Join-Path $testRoot "empty-output"
    New-Item -ItemType Directory -Path $emptyOutput -Force | Out-Null
    [void](Initialize-OfficeKitOutputDirectory -Path $emptyOutput -RepositoryRoot $repositoryRoot)
    $nonEmptyOutput = Join-Path $testRoot "non-empty-output"
    New-Item -ItemType Directory -Path $nonEmptyOutput -Force | Out-Null
    $sentinel = Join-Path $nonEmptyOutput "preserve-me.txt"
    Set-Content -LiteralPath $sentinel -Value "caller-owned content"
    Assert-Throws { Initialize-OfficeKitOutputDirectory -Path $nonEmptyOutput -RepositoryRoot $repositoryRoot } "output_directory_must_be_empty"
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) { throw "non-empty output directory content was deleted" }
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne "caller-owned content") { throw "non-empty output directory content was modified" }
    Assert-Throws { Initialize-OfficeKitOutputDirectory -Path $repositoryRoot -RepositoryRoot $repositoryRoot } "output_directory_cannot_be_inside_repository"
    $repositoryChild = Join-Path $repositoryRoot "build-output"
    Assert-Throws { Initialize-OfficeKitOutputDirectory -Path $repositoryChild -RepositoryRoot $repositoryRoot } "output_directory_cannot_be_inside_repository"
    Assert-Throws { Initialize-OfficeKitOutputDirectory -Path $testRoot -RepositoryRoot $repositoryRoot } "output_directory_cannot_contain_repository"
    Assert-Throws { Initialize-OfficeKitOutputDirectory -Path ([System.IO.Path]::GetPathRoot($testRoot)) -RepositoryRoot $repositoryRoot } "output_directory_cannot_be_filesystem_root"
    $junction = Join-Path $testRoot "output-junction"
    $junctionResult = & cmd.exe /c mklink /J $junction $testRoot 2>&1
    if ($LASTEXITCODE -ne 0) { throw "could_not_create_test_junction: $junctionResult" }
    try {
        $junctionOutput = Join-Path $junction "redirected-output"
        Assert-Throws { Initialize-OfficeKitOutputDirectory -Path $junctionOutput -RepositoryRoot $repositoryRoot } "output_directory_reparse_path_component_not_allowed"
    } finally {
        Remove-Item -LiteralPath $junction -Force
    }
    $filePath = Join-Path $testRoot "not-a-directory.txt"
    Set-Content -LiteralPath $filePath -Value "file"
    Assert-Throws { Initialize-OfficeKitOutputDirectory -Path $filePath -RepositoryRoot $repositoryRoot } "output_directory_is_file"
    Write-Output "MSIX output-directory safety tests passed."
} finally {
    if (Test-Path -LiteralPath $testRoot -PathType Container) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
