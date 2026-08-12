[CmdletBinding()]
param(
  [string]$OutputDirectory = "",
  [switch]$SkipBuild,
  [string]$NodeArchivePath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
  }
}

function Assert-SafeChildPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ParentPath,
    [Parameter(Mandatory = $true)]
    [string]$ChildPath
  )

  $resolvedParent = [IO.Path]::GetFullPath($ParentPath).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $resolvedChild = [IO.Path]::GetFullPath($ChildPath)
  $prefix = $resolvedParent + [IO.Path]::DirectorySeparatorChar

  if (-not $resolvedChild.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside the expected directory: $resolvedChild"
  }
}

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Get-Sha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageConfigPath = Join-Path $repoRoot "packaging\windows-package.json"
$packageConfig = Get-Content -Raw -LiteralPath $packageConfigPath | ConvertFrom-Json

if ($packageConfig.platform -ne "win32" -or $packageConfig.architecture -ne "x64") {
  throw "This packager currently supports only win32-x64."
}

if ($packageConfig.version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
  throw "Invalid package version: $($packageConfig.version)"
}

if ($packageConfig.nodeVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "Invalid Node.js version: $($packageConfig.nodeVersion)"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repoRoot "artifacts"
}
$resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory | Out-Null

if (-not $SkipBuild) {
  Push-Location $repoRoot
  try {
    Invoke-CheckedCommand -FilePath "pnpm" -ArgumentList @(
      "install",
      "--frozen-lockfile",
      "--config.confirmModulesPurge=false"
    )
    Invoke-CheckedCommand -FilePath "pnpm" -ArgumentList @("build")
  }
  finally {
    Pop-Location
  }
}

$artifactBaseName = "IQ-Wealth-Quick-Notes-$($packageConfig.version)-win-x64"
$artifactFileName = "$artifactBaseName.zip"
$artifactPath = Join-Path $resolvedOutputDirectory $artifactFileName
$checksumPath = "$artifactPath.sha256"
$scratchRoot = Join-Path ([IO.Path]::GetTempPath()) "iq-quick-notes-package-$([Guid]::NewGuid().ToString('N'))"
$packageRoot = Join-Path $scratchRoot "package"
$appRoot = Join-Path $packageRoot "app"
$runtimeRoot = Join-Path $packageRoot "runtime"
$binRoot = Join-Path $packageRoot "bin"
$nodeExtractRoot = Join-Path $scratchRoot "node"
$deploymentWorkspace = Join-Path $scratchRoot "workspace"

try {
  New-Item -ItemType Directory -Force -Path $appRoot, $runtimeRoot, $binRoot, $nodeExtractRoot, $deploymentWorkspace | Out-Null

  foreach ($file in @("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "README.md")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $deploymentWorkspace $file)
  }

  $workspacePackagesRoot = Join-Path $deploymentWorkspace "packages"
  New-Item -ItemType Directory -Force -Path $workspacePackagesRoot | Out-Null
  foreach ($packageName in @("app", "rfm", "server")) {
    $sourcePackageRoot = Join-Path $repoRoot "packages\$packageName"
    $targetPackageRoot = Join-Path $workspacePackagesRoot $packageName
    New-Item -ItemType Directory -Force -Path $targetPackageRoot | Out-Null

    if (Test-Path -LiteralPath (Join-Path $sourcePackageRoot "package.json")) {
      Copy-Item -LiteralPath (Join-Path $sourcePackageRoot "package.json") -Destination (Join-Path $targetPackageRoot "package.json")
    }
    if (Test-Path -LiteralPath (Join-Path $sourcePackageRoot "dist")) {
      Copy-Item -LiteralPath (Join-Path $sourcePackageRoot "dist") -Destination $targetPackageRoot -Recurse
    }
  }
  Copy-Item -LiteralPath (Join-Path $repoRoot "packages\server\bin") -Destination (Join-Path $workspacePackagesRoot "server") -Recurse
  Copy-Item -LiteralPath (Join-Path $repoRoot "packages\server\defaults.mjs") -Destination (Join-Path $workspacePackagesRoot "server\defaults.mjs")
  Copy-Item -LiteralPath (Join-Path $repoRoot "packages\server\defaults.d.mts") -Destination (Join-Path $workspacePackagesRoot "server\defaults.d.mts")

  Push-Location $deploymentWorkspace
  try {
    Invoke-CheckedCommand -FilePath "pnpm" -ArgumentList @(
      "--config.node-linker=hoisted",
      "--filter",
      "roughdraft",
      "deploy",
      "--prod",
      "--legacy",
      $appRoot
    )
  }
  finally {
    Pop-Location
  }

  $deployedPackagePath = Join-Path $appRoot "package.json"
  $deployedPackage = Get-Content -Raw -LiteralPath $deployedPackagePath | ConvertFrom-Json
  $runtimePackage = [ordered]@{
    name = $packageConfig.packageName
    version = $packageConfig.version
    private = $true
    type = "module"
    description = "IQ Wealth managed Quick Notes runtime"
    license = $deployedPackage.license
    bin = [ordered]@{
      roughdraft = "./packages/server/bin/roughdraft.mjs"
    }
    dependencies = $deployedPackage.dependencies
  }
  Write-Utf8File -Path $deployedPackagePath -Content (($runtimePackage | ConvertTo-Json -Depth 20) + "`n")

  $deployedReadmePath = Join-Path $appRoot "README.md"
  if (Test-Path -LiteralPath $deployedReadmePath) {
    Remove-Item -LiteralPath $deployedReadmePath -Force
  }

  $nodeArchiveName = "node-v$($packageConfig.nodeVersion)-win-x64.zip"
  $nodeBaseUrl = "https://nodejs.org/dist/v$($packageConfig.nodeVersion)"
  $checksumsUrl = "$nodeBaseUrl/SHASUMS256.txt"
  $checksums = (Invoke-WebRequest -UseBasicParsing -Uri $checksumsUrl).Content
  $checksumLine = @(
    $checksums -split "`n" |
      Where-Object { $_.Trim() -match "^[0-9a-fA-F]{64}\s+$([regex]::Escape($nodeArchiveName))$" }
  )
  if ($checksumLine.Count -ne 1) {
    throw "Could not find a unique checksum for $nodeArchiveName in $checksumsUrl"
  }
  $expectedNodeHash = ($checksumLine[0].Trim() -split '\s+')[0].ToLowerInvariant()

  if ([string]::IsNullOrWhiteSpace($NodeArchivePath)) {
    $nodeCacheRoot = Join-Path $repoRoot ".context\package-cache\node-v$($packageConfig.nodeVersion)"
    New-Item -ItemType Directory -Force -Path $nodeCacheRoot | Out-Null
    $resolvedNodeArchivePath = Join-Path $nodeCacheRoot $nodeArchiveName

    $needsDownload = -not (Test-Path -LiteralPath $resolvedNodeArchivePath)
    if (-not $needsDownload) {
      $cachedHash = Get-Sha256 -Path $resolvedNodeArchivePath
      $needsDownload = $cachedHash -ne $expectedNodeHash
    }

    if ($needsDownload) {
      if (Test-Path -LiteralPath $resolvedNodeArchivePath) {
        Assert-SafeChildPath -ParentPath $nodeCacheRoot -ChildPath $resolvedNodeArchivePath
        Remove-Item -LiteralPath $resolvedNodeArchivePath -Force
      }
      Invoke-WebRequest -UseBasicParsing -Uri "$nodeBaseUrl/$nodeArchiveName" -OutFile $resolvedNodeArchivePath
    }
  }
  else {
    $resolvedNodeArchivePath = [IO.Path]::GetFullPath($NodeArchivePath)
  }

  if (-not (Test-Path -LiteralPath $resolvedNodeArchivePath -PathType Leaf)) {
    throw "Node.js archive not found: $resolvedNodeArchivePath"
  }

  $actualNodeHash = Get-Sha256 -Path $resolvedNodeArchivePath
  if ($actualNodeHash -ne $expectedNodeHash) {
    throw "Node.js checksum mismatch for $resolvedNodeArchivePath"
  }

  Expand-Archive -LiteralPath $resolvedNodeArchivePath -DestinationPath $nodeExtractRoot
  $expandedNodeRoot = Join-Path $nodeExtractRoot "node-v$($packageConfig.nodeVersion)-win-x64"
  Copy-Item -LiteralPath (Join-Path $expandedNodeRoot "node.exe") -Destination (Join-Path $runtimeRoot "node.exe")
  Copy-Item -LiteralPath (Join-Path $expandedNodeRoot "LICENSE") -Destination (Join-Path $runtimeRoot "NODE-LICENSE.txt")

  Copy-Item -Path (Join-Path $repoRoot "packaging\windows\*") -Destination $binRoot

  $releaseManifest = [ordered]@{
    schemaVersion = $packageConfig.schemaVersion
    product = $packageConfig.product
    packageName = $packageConfig.packageName
    version = $packageConfig.version
    platform = $packageConfig.platform
    architecture = $packageConfig.architecture
    nodeVersion = $packageConfig.nodeVersion
    command = $packageConfig.command
    agentCommand = $packageConfig.agentCommand
    fileAssociationInstaller = $packageConfig.fileAssociationInstaller
    releaseTag = $packageConfig.releaseTag
  }
  Write-Utf8File -Path (Join-Path $packageRoot "manifest.json") -Content (($releaseManifest | ConvertTo-Json -Depth 20) + "`n")

  $packageReadme = @"
IQ Wealth Quick Notes $($packageConfig.version)

This is an IQ Wealth-managed runtime package. Clients do not need Node.js,
Git, npm or pnpm.

People can open a Markdown file with:

  bin\Quick Notes.cmd "C:\path\to\note.md"

IQ Wealth agents should invoke:

  bin\roughdraft.cmd open "C:\path\to\note.md" --json --no-watch

To add Quick Notes to Windows' Open with list without changing the current
Markdown default, run:

  bin\Register Quick Notes.cmd

Do not install roughdraft from npm. Updates are supplied as approved,
version-pinned IQ Wealth Quick Notes packages.
"@
  Write-Utf8File -Path (Join-Path $packageRoot "README.txt") -Content ($packageReadme.Trim() + "`r`n")

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  foreach ($outputPath in @($artifactPath, $checksumPath)) {
    if (Test-Path -LiteralPath $outputPath) {
      Assert-SafeChildPath -ParentPath $resolvedOutputDirectory -ChildPath $outputPath
      Remove-Item -LiteralPath $outputPath -Force
    }
  }
  [IO.Compression.ZipFile]::CreateFromDirectory(
    $packageRoot,
    $artifactPath,
    [IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  $artifactHash = Get-Sha256 -Path $artifactPath
  Write-Utf8File -Path $checksumPath -Content "$artifactHash  $artifactFileName`n"

  [PSCustomObject]@{
    artifact = $artifactPath
    sha256 = $artifactHash
    checksumFile = $checksumPath
    version = $packageConfig.version
    nodeVersion = $packageConfig.nodeVersion
  } | ConvertTo-Json
}
finally {
  if (Test-Path -LiteralPath $scratchRoot) {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    Assert-SafeChildPath -ParentPath $tempRoot -ChildPath $scratchRoot
    Remove-Item -LiteralPath $scratchRoot -Recurse -Force
  }
}
