[CmdletBinding()]
param(
  [string]$PackagePath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-Condition {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
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
$packageConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "packaging\windows-package.json") | ConvertFrom-Json
$artifactFileName = "IQ-Wealth-Quick-Notes-$($packageConfig.version)-win-x64.zip"
if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $PackagePath = Join-Path $repoRoot "artifacts\$artifactFileName"
}
$resolvedPackagePath = [IO.Path]::GetFullPath($PackagePath)
Assert-Condition -Condition (Test-Path -LiteralPath $resolvedPackagePath -PathType Leaf) -Message "Package not found: $resolvedPackagePath"

$checksumPath = "$resolvedPackagePath.sha256"
Assert-Condition -Condition (Test-Path -LiteralPath $checksumPath -PathType Leaf) -Message "Checksum file not found: $checksumPath"
$checksumParts = (Get-Content -Raw -LiteralPath $checksumPath).Trim() -split '\s+', 2
$expectedHash = $checksumParts[0].ToLowerInvariant()
$actualHash = Get-Sha256 -Path $resolvedPackagePath
Assert-Condition -Condition ($actualHash -eq $expectedHash) -Message "Package SHA-256 does not match its checksum file."

$scratchRoot = Join-Path ([IO.Path]::GetTempPath()) "iq-quick-notes-test-$([Guid]::NewGuid().ToString('N'))"
$extractRoot = Join-Path $scratchRoot "extract"
$notePath = Join-Path $scratchRoot "acceptance-note.md"
$stateRoot = Join-Path $scratchRoot "state"
$serverStarted = $false
$launcherPath = $null
$originalPath = $env:PATH
$originalStateDir = $env:ROUGHDRAFT_STATE_DIR
$originalNoOpen = $env:ROUGHDRAFT_NO_OPEN

try {
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $resolvedPackagePath -DestinationPath $extractRoot

  $packageRoots = @(Get-ChildItem -LiteralPath $extractRoot -Directory)
  Assert-Condition -Condition ($packageRoots.Count -eq 1) -Message "Package must contain exactly one top-level directory."
  $packageRoot = $packageRoots[0].FullName
  $manifestPath = Join-Path $packageRoot "manifest.json"
  $launcherPath = Join-Path $packageRoot "bin\roughdraft.cmd"
  $bundledNodePath = Join-Path $packageRoot "runtime\node.exe"

  Assert-Condition -Condition (Test-Path -LiteralPath $manifestPath -PathType Leaf) -Message "manifest.json is missing."
  Assert-Condition -Condition (Test-Path -LiteralPath $launcherPath -PathType Leaf) -Message "roughdraft.cmd is missing."
  Assert-Condition -Condition (Test-Path -LiteralPath $bundledNodePath -PathType Leaf) -Message "The bundled Node.js runtime is missing."
  Assert-Condition -Condition (-not (Test-Path -LiteralPath (Join-Path $packageRoot ".git"))) -Message "The package must not contain Git metadata."
  Assert-Condition -Condition (-not (Test-Path -LiteralPath (Join-Path $packageRoot "app\packages\server\src"))) -Message "The package must not contain TypeScript server source."

  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  Assert-Condition -Condition ($manifest.version -eq $packageConfig.version) -Message "Package manifest version does not match packaging/windows-package.json."
  Assert-Condition -Condition ($manifest.nodeVersion -eq $packageConfig.nodeVersion) -Message "Bundled Node.js version does not match packaging/windows-package.json."

  [IO.File]::WriteAllText(
    $notePath,
    "# IQ Wealth Quick Notes package acceptance test`n`n- [ ] Opened with the bundled runtime.`n",
    [Text.UTF8Encoding]::new($false)
  )

  $env:PATH = "$env:SystemRoot\System32"
  $env:ROUGHDRAFT_STATE_DIR = $stateRoot
  $env:ROUGHDRAFT_NO_OPEN = "1"

  Assert-Condition -Condition ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) -Message "The test PATH unexpectedly exposes a system Node.js executable."

  $nodeVersionOutput = (& $bundledNodePath --version 2>&1 | Out-String).Trim()
  Assert-Condition -Condition ($LASTEXITCODE -eq 0) -Message "The bundled Node.js runtime could not start."
  Assert-Condition -Condition ($nodeVersionOutput -eq "v$($packageConfig.nodeVersion)") -Message "The bundled runtime reported '$nodeVersionOutput' instead of 'v$($packageConfig.nodeVersion)'."

  $versionOutput = (& $launcherPath --version 2>&1 | Out-String).Trim()
  Assert-Condition -Condition ($LASTEXITCODE -eq 0) -Message "The packaged launcher failed to report its version."
  Assert-Condition -Condition ($versionOutput -eq $packageConfig.version) -Message "The packaged launcher reported version '$versionOutput' instead of '$($packageConfig.version)'."

  $openOutput = (& $launcherPath open $notePath --no-open --no-watch --json 2>&1 | Out-String).Trim()
  Assert-Condition -Condition ($LASTEXITCODE -eq 0) -Message "The packaged launcher could not open a Markdown file: $openOutput"
  $openResult = $openOutput | ConvertFrom-Json
  Assert-Condition -Condition ($openResult.opened -eq $true) -Message "The packaged CLI did not report the Markdown file as opened."
  Assert-Condition -Condition ($openResult.openMode -eq "disabled") -Message "The acceptance test unexpectedly launched a browser."
  $serverStarted = $true

  $response = Invoke-WebRequest -UseBasicParsing -Uri $openResult.url
  Assert-Condition -Condition ($response.StatusCode -eq 200) -Message "The packaged app did not return HTTP 200."
  Assert-Condition -Condition ($response.Content.Contains('id="root"')) -Message "The packaged app shell is missing its root element."

  $stopOutput = (& $launcherPath stop --json 2>&1 | Out-String).Trim()
  Assert-Condition -Condition ($LASTEXITCODE -eq 0) -Message "The packaged launcher could not stop its server: $stopOutput"
  $stopResult = $stopOutput | ConvertFrom-Json
  Assert-Condition -Condition ($stopResult.stopped -eq $true) -Message "The packaged server did not report a clean stop."
  $serverStarted = $false

  [PSCustomObject]@{
    package = $resolvedPackagePath
    version = $manifest.version
    nodeVersion = $manifest.nodeVersion
    sha256 = $actualHash
    httpStatus = $response.StatusCode
    systemNodeRequired = $false
    result = "passed"
  } | ConvertTo-Json
}
finally {
  if ($serverStarted -and $null -ne $launcherPath -and (Test-Path -LiteralPath $launcherPath)) {
    try {
      & $launcherPath stop --json | Out-Null
    }
    catch {}
  }

  $env:PATH = $originalPath
  $env:ROUGHDRAFT_STATE_DIR = $originalStateDir
  $env:ROUGHDRAFT_NO_OPEN = $originalNoOpen

  if (Test-Path -LiteralPath $scratchRoot) {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    Assert-SafeChildPath -ParentPath $tempRoot -ChildPath $scratchRoot
    Remove-Item -LiteralPath $scratchRoot -Recurse -Force
  }
}
