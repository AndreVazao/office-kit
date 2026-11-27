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
    if ($normalizedPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "output_directory_cannot_be_filesystem_root" }
    if ($normalizedPath.Equals($normalizedRepository, [System.StringComparison]::OrdinalIgnoreCase)) { throw "output_directory_cannot_be_repository_root" }
    $outputPrefix = $normalizedPath + [System.IO.Path]::DirectorySeparatorChar
    if ($normalizedRepository.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "output_directory_cannot_contain_repository" }
    if (Test-Path -LiteralPath $resolvedPath -PathType Leaf) { throw "output_directory_is_file" }
    if (Test-Path -LiteralPath $resolvedPath -PathType Container) {
        $item = Get-Item -LiteralPath $resolvedPath -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "output_directory_reparse_point_not_allowed" }
        $existing = Get-ChildItem -LiteralPath $resolvedPath -Force | Select-Object -First 1
        if ($null -ne $existing) { throw "output_directory_must_be_empty_existing_contents_preserved" }
    } else {
        New-Item -ItemType Directory -Path $resolvedPath -Force | Out-Null
    }
    return $resolvedPath
}
Export-ModuleMember -Function Initialize-OfficeKitOutputDirectory
