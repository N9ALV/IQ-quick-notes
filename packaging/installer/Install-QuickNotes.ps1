[CmdletBinding()]
param([string]$PackageRoot = '', [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'IQ Wealth/Quick Notes'), [switch]$NoRegistration, [switch]$NoShortcuts)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PackageRoot)) { $PackageRoot = $PSScriptRoot }
. (Join-Path $PSScriptRoot 'bin/QuickNotes-Lifecycle.ps1')
$source = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\', '/')
$package = Test-QNPackage $source
$candidateRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\', '/')
if ($candidateRoot -eq $source -or $candidateRoot.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith($candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep the extracted package separate from the installation folder.' }
$root = Initialise-QNRoot $candidateRoot
$lock = [IO.File]::Open((Get-QNChild $root 'lifecycle.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$stage = $null
try {
  $current = Get-QNCurrent $root
  $version = $package.Manifest.version
  $target = Get-QNChild $root "versions/$version"
  if (Test-Path -LiteralPath $target) {
    $existing = Test-QNPackage $target
    if ($existing.Fingerprint -cne $package.Fingerprint) { throw 'This version is already installed with different contents. It will not be overwritten.' }
  } else {
    $stage = Get-QNChild (Join-Path $root 'staging') ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $stage -Recurse
    $copied = Test-QNPackage $stage
    if ($copied.Fingerprint -cne $package.Fingerprint) { throw 'The copied package does not match the verified source.' }
    [IO.Directory]::Move($stage, $target)
    $stage = $null
  }
  Test-QNHealth $target (Join-Path $root 'staging') $package.Manifest
  Initialise-QNVersionState $root $version | Out-Null
  # Stable scripts are small version-independent dispatchers. The pointer is
  # changed only once all validation and health checks have completed.
  foreach ($name in @('Quick Notes.cmd', 'roughdraft.cmd', 'QuickNotes-Launch.ps1', 'QuickNotes-Lifecycle.ps1', 'Register-QuickNotesFileOpener.ps1', 'Register Quick Notes.cmd', 'Remove Quick Notes.cmd')) {
    $destination = Get-QNChild $root "bin/$name"
    Copy-Item -LiteralPath (Join-Path $target "bin/$name") -Destination $destination -Force
  }
  foreach ($name in @('Rollback-QuickNotes.ps1', 'Rollback Quick Notes.cmd')) { Copy-Item -LiteralPath (Join-Path $target $name) -Destination (Get-QNChild $root $name) -Force }
  if ($null -eq $current -or $current.version -cne $version) {
    $previous = if ($null -eq $current) { $null } else { $current.version }
    if ($null -ne $current -and $null -ne $current.PSObject.Properties['legacyUnverified']) {
      $backup = Get-QNChild $root 'legacy-current.json'
      $originalPointer = Get-QNChild $root 'current.json'
      if (Test-Path -LiteralPath $backup) {
        if ((Get-QNHash $backup) -ne (Get-QNHash $originalPointer)) { throw 'A different legacy recovery pointer already exists. It will not be overwritten.' }
      } else { Copy-Item -LiteralPath $originalPointer -Destination $backup }
      $previous = $null
      Write-Host 'The older installation and its original pointer have been retained. Automatic rollback requires a verified managed version; ask IQ Wealth for help with legacy recovery.'
    }
    Set-QNCurrent $root $version $previous
  }
  if (-not $NoRegistration) { & (Join-Path $root 'bin/Register-QuickNotesFileOpener.ps1') -NoSettings }
  if (-not $NoShortcuts) { Add-QNShortcuts $root }
  Write-Host "Quick Notes $version is installed. Your notes and Markdown default application have not been changed."
} finally {
  $lock.Dispose()
  if ($stage -and (Test-Path -LiteralPath $stage)) { $safeStage = Get-QNChild (Join-Path $root 'staging') (Split-Path -Leaf $stage); Remove-Item -LiteralPath $safeStage -Recurse -Force }
}
