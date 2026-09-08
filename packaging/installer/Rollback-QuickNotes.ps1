[CmdletBinding()]
param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'IQ Wealth/Quick Notes'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'bin/QuickNotes-Lifecycle.ps1')
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\', '/')
$current = Get-QNCurrent $root
if ($null -eq $current -or $null -eq $current.previousVersion) { throw 'No verified previous managed version is available for rollback.' }
$lock = [IO.File]::Open((Get-QNChild $root 'lifecycle.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
  $current = Get-QNCurrent $root
  if ($null -eq $current.previousVersion) { throw 'No previous managed version is available.' }
  $previousRoot = Get-QNChild $root ('versions/' + $current.previousVersion)
  $package = Test-QNPackage $previousRoot
  if ($package.Manifest.version -cne $current.previousVersion) { throw 'The retained version does not match the rollback pointer.' }
  Test-QNHealth $previousRoot (Get-QNChild $root 'staging') $package.Manifest
  Initialise-QNVersionState $root $current.previousVersion | Out-Null
  Set-QNCurrent $root $current.previousVersion $current.version
  Write-Host "Quick Notes has returned to version $($current.previousVersion). Existing open sessions remain running."
} finally { $lock.Dispose() }
