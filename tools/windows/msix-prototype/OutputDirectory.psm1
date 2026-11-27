function Test-OfficeKitPathWithin([string]$Candidate, [string]$Parent) {
    $candidateFull = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($Candidate))
    $parentFull = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($Parent))
    if ($candidateFull.Equals($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
    return $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-OfficeKitPathHasNoReparseAncestors([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    $relative = $fullPath.Substring($root.Length)
    $current = $root
    foreach ($segment in ($relative -split '[\\\\/]' | Where-Object { $_.Length -gt 0 })) {
        $current = Join-Path $current $segment
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "output_directory_reparse_path_component_not_allowed"
            }
        }
    }
}

function Initialize-OfficeKitOutputDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepositoryRoot
    )
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $resolvedRepository = [System.IO.Path]::GetFullPath($RepositoryRoot)
    $normalizedPath = [System.IO.Path]::TrimEndingDirectorySeparator($resolvedPath)
    $normalizedRepository = [System.IO.Path]::TrimEndingDirectorySeparator($resolvedRepository)
    $root = [System.IO.Path]::GetPathRoot($normalizedPath)
    $normalizedRoot = [System.IO.Path]::TrimEndingDirectorySeparator($root)

    if ($normalizedPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "output_directory_cannot_be_filesystem_root"
    }
    if (Test-OfficeKitPathWithin -Candidate $normalizedPath -Parent $normalizedRepository) {
        throw "output_directory_cannot_be_inside_repository"
    }
    if (Test-OfficeKitPathWithin -Candidate $normalizedRepository -Parent $normalizedPath) {
        throw "output_directory_cannot_contain_repository"
    }
    if (Test-Path -LiteralPath $resolvedPath -PathType Leaf) { throw "output_directory_is_file" }

    # Reject junctions/symlinks in every existing component, not only the leaf.
    # Otherwise an apparently external path could redirect writes into protected data.
    Assert-OfficeKitPathHasNoReparseAncestors -Path $resolvedPath

    if (Test-Path -LiteralPath $resolvedPath -PathType Container) {
        $existing = Get-ChildItem -LiteralPath $resolvedPath -Force | Select-Object -First 1
        if ($null -ne $existing) { throw "output_directory_must_be_empty_existing_contents_preserved" }
    } else {
        New-Item -ItemType Directory -Path $resolvedPath -Force | Out-Null
        Assert-OfficeKitPathHasNoReparseAncestors -Path $resolvedPath
    }
    return $resolvedPath
}
Export-ModuleMember -Function Initialize-OfficeKitOutputDirectory
