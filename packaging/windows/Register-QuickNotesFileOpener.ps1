[CmdletBinding()]
param(
  [switch]$Remove,
  [switch]$NoSettings,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$applicationName = "IQ Wealth Quick Notes"
$progId = "IQWealth.QuickNotes.Markdown"
$capabilitiesPath = "Software\IQ Wealth\Quick Notes\Capabilities"
$classesRoot = "HKCU:\Software\Classes"
$progIdPath = Join-Path $classesRoot $progId
$openWithPath = Join-Path $classesRoot ".md\OpenWithProgids"
$capabilitiesRegistryPath = "HKCU:\$capabilitiesPath"
$registeredApplicationsPath = "HKCU:\Software\RegisteredApplications"
$installRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$launcherPath = Join-Path $installRoot "bin\Quick Notes.cmd"
$openCommand = '"{0}" "%1"' -f $launcherPath
$settingsUri = "ms-settings:defaultapps?registeredAppUser=$([Uri]::EscapeDataString($applicationName))"

if ($ValidateOnly) {
  [PSCustomObject]@{
    applicationName = $applicationName
    launcherPath = $launcherPath
    openCommand = $openCommand
    settingsUri = $settingsUri
  } | ConvertTo-Json
  exit 0
}

if ($Remove) {
  Remove-Item -LiteralPath $progIdPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $capabilitiesRegistryPath -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -LiteralPath $registeredApplicationsPath -Name $applicationName -ErrorAction SilentlyContinue
  Remove-ItemProperty -LiteralPath $openWithPath -Name $progId -ErrorAction SilentlyContinue
  Write-Host "IQ Wealth Quick Notes has been removed from Windows' Open with list."
  Write-Host "Your existing Markdown default application was not changed."
  exit 0
}

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "Quick Notes launcher not found: $launcherPath"
}

New-Item -Path $progIdPath -Force | Out-Null
Set-Item -LiteralPath $progIdPath -Value "IQ Wealth Quick Notes Markdown file"
New-Item -Path (Join-Path $progIdPath "shell\open\command") -Force | Out-Null
Set-Item -LiteralPath (Join-Path $progIdPath "shell\open\command") -Value $openCommand

New-Item -Path $openWithPath -Force | Out-Null
New-ItemProperty -LiteralPath $openWithPath -Name $progId -PropertyType String -Value "" -Force | Out-Null

New-Item -Path (Join-Path $capabilitiesRegistryPath "FileAssociations") -Force | Out-Null
New-ItemProperty -LiteralPath $capabilitiesRegistryPath -Name "ApplicationName" -PropertyType String -Value $applicationName -Force | Out-Null
New-ItemProperty -LiteralPath $capabilitiesRegistryPath -Name "ApplicationDescription" -PropertyType String -Value "Open local Markdown notes in IQ Wealth Quick Notes." -Force | Out-Null
New-ItemProperty -LiteralPath (Join-Path $capabilitiesRegistryPath "FileAssociations") -Name ".md" -PropertyType String -Value $progId -Force | Out-Null

New-Item -Path $registeredApplicationsPath -Force | Out-Null
New-ItemProperty -LiteralPath $registeredApplicationsPath -Name $applicationName -PropertyType String -Value $capabilitiesPath -Force | Out-Null

Write-Host "IQ Wealth Quick Notes is now available in Windows' Open with list."
Write-Host "Your current Markdown default, including VS Code, has not been changed."

if (-not $NoSettings) {
  Write-Host "Windows Default Apps will now open. Choose Quick Notes for .md files only if you want it as the default."
  Start-Process $settingsUri
}
