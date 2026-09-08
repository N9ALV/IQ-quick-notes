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

function Invoke-LockedRuntimeDeployment {
  param([string]$Workspace, [string]$Target)

  if (-not (Test-Path -LiteralPath (Join-Path $Workspace "pnpm-lock.yaml") -PathType Leaf)) {
    throw "The reviewed dependency lockfile is missing. Runtime deployment will not resolve replacement versions."
  }
  Push-Location $Workspace
  try {
    Invoke-CheckedCommand -FilePath "pnpm" -ArgumentList @(
      "--config.node-linker=hoisted",
      # Legacy hoisted deploy explicitly disables lockfile reading in pnpm 11.
      # Shared-lockfile deployment derives a production lock and performs a
      # frozen install. These flags affect only the temporary workspace.
      "--config.shared-workspace-lockfile=true",
      "--config.lockfile=true",
      "--config.inject-workspace-packages=true",
      "--config.force-legacy-deploy=false",
      "--filter",
      "iq-wealth-quick-notes",
      "deploy",
      "--prod",
      $Target
    )
  }
  finally { Pop-Location }
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

  Invoke-LockedRuntimeDeployment -Workspace $deploymentWorkspace -Target $appRoot

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
  Copy-Item -Path (Join-Path $repoRoot "packaging\installer\*") -Destination $packageRoot
  Copy-Item -LiteralPath (Join-Path $repoRoot "NOTICE.md") -Destination (Join-Path $packageRoot "NOTICE.md")

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
    installer = $packageConfig.installer
    integrityInventory = $packageConfig.integrityInventory
    releaseTag = $packageConfig.releaseTag
  }
  Write-Utf8File -Path (Join-Path $packageRoot "manifest.json") -Content (($releaseManifest | ConvertTo-Json -Depth 20) + "`n")

  $packageReadme = @"
IQ Wealth Quick Notes $($packageConfig.version)

This is the approved Windows application package, not the Skill instructions.
You do not need Node.js, Git, npm, pnpm or administrator rights.

1. Obtain this ZIP and its SHA-256 from the approved IU Quick Notes page.
2. Check the ZIP's SHA-256, then use Windows' Extract All.
3. Open Install Quick Notes.cmd in the extracted folder.
4. Open IQ Wealth Quick Notes from the Start menu and choose a Markdown file.

The installer checks every packaged file before running the bundled app,
installs a separate version and retains the previous files. Automatic rollback
requires a retained version with a verified inventory (0.2.0 or later).
The file inventory checks integrity; the independently obtained ZIP hash and
approved download source are what establish authenticity.

Installation location:

  %LOCALAPPDATA%\IQ Wealth\Quick Notes

Your notes and existing Markdown default (including VS Code) are not changed.
Quick Notes is added to the Open with list. You may choose it as the default
through Windows Default Apps, but this is optional.

For an update, close or finish reviewing your existing notes, download the
approved new package and run its installer. Existing open sessions are not
forcibly closed. Rollback Quick Notes.cmd selects a verified previous version.
Pre-0.2.0 files and their old pointer are retained for IQ Wealth-assisted
recovery, but cannot be selected by automatic rollback without verification.

People can open a Markdown file with:

  bin\Quick Notes.cmd "C:\path\to\note.md"

IQ Wealth agents should invoke the stable installed compatibility launcher:

  "%LOCALAPPDATA%\IQ Wealth\Quick Notes\bin\roughdraft.cmd" open "C:\path\to\note.md" --json --no-watch

To add Quick Notes to Windows' Open with list without changing the current
Markdown default, run:

  bin\Register Quick Notes.cmd

Do not install roughdraft from npm. This application is based on Roughdraft;
upstream attribution is retained in NOTICE.md. Help, current instructions and
approved downloads: https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/
"@
  Write-Utf8File -Path (Join-Path $packageRoot "README.txt") -Content ($packageReadme.Trim() + "`r`n")

  # Include the actual notices for production packages incorporated into the
  # frontend, as well as the server dependencies retained in node_modules.
  Push-Location $repoRoot
  try {
    $licenceOutput = & pnpm licenses list --prod --json
    if ($LASTEXITCODE -ne 0) { throw "Could not collect production dependency licences." }
    $licenceGroups = ($licenceOutput -join "`n") | ConvertFrom-Json
  }
  finally { Pop-Location }
  $licenceText = [Text.StringBuilder]::new()
  [void]$licenceText.AppendLine("IQ Wealth Quick Notes - third-party licences")
  [void]$licenceText.AppendLine("Generated from the verified lockfile's production dependency graph.")
  foreach ($group in $licenceGroups.PSObject.Properties | Sort-Object Name) {
    foreach ($dependency in $group.Value | Sort-Object name) {
      [void]$licenceText.AppendLine("`n========================================")
      [void]$licenceText.AppendLine("$($dependency.name) $($dependency.versions -join ', ')")
      [void]$licenceText.AppendLine("Declared licence: $($group.Name)")
      foreach ($dependencyPath in $dependency.paths) {
        $noticeFiles = @(Get-ChildItem -LiteralPath $dependencyPath -File | Where-Object {
          $_.Name -match '^(licen[sc]e|copying|copyright|notice|ofl|unlicense)(\..+)?$'
        } | Sort-Object Name)
        foreach ($noticeFile in $noticeFiles) {
          [void]$licenceText.AppendLine("`n--- $($noticeFile.Name) ---")
          [void]$licenceText.AppendLine([IO.File]::ReadAllText($noticeFile.FullName))
        }
        if ($noticeFiles.Count -eq 0) {
          [void]$licenceText.AppendLine("No separate licence file supplied; see the package metadata and upstream project.")
        }
      }
    }
  }
  Write-Utf8File -Path (Join-Path $packageRoot "THIRD-PARTY-LICENCES.txt") -Content $licenceText.ToString()

  # The inventory is generated last and deliberately excludes itself. It is an
  # integrity check, not a signature: clients also verify the approved ZIP hash.
  $inventoryFiles = @(
    Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
      if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "The package cannot contain a reparse point: $($_.FullName)"
      }
      [ordered]@{
        path = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
        size = $_.Length
        sha256 = Get-Sha256 -Path $_.FullName
      }
    }
  )
  $inventory = [ordered]@{ schemaVersion = 1; files = $inventoryFiles }
  Write-Utf8File -Path (Join-Path $packageRoot "integrity.json") -Content (($inventory | ConvertTo-Json -Depth 5) + "`n")

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
