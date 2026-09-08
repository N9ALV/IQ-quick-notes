# Shared by the package installer, rollback command and stable launch bridge.
# This inventory detects corruption, not a malicious publisher. Verify the ZIP
# SHA-256 obtained separately from the approved IU source before extracting it.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-QNVersion([string]$Version) {
  if ($Version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$' -or $Version.Length -gt 100) { throw 'The Quick Notes version is invalid or unsupported.' }
}
function Assert-QNPlainPath([string]$Path) {
  $itemPath = [IO.Path]::GetFullPath($Path)
  while ($itemPath) {
    if (Test-Path -LiteralPath $itemPath) {
      $item = Get-Item -LiteralPath $itemPath -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked folders or files are not supported: $itemPath" }
    }
    $itemPath = Split-Path -Parent $itemPath
  }
}
function Get-QNChild([string]$Root, [string]$Relative) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $child = [IO.Path]::GetFullPath((Join-Path $rootPath $Relative))
  if (-not $child.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'A path leaves the approved Quick Notes directory.' }
  Assert-QNPlainPath $child
  return $child
}
function Write-QNJson([string]$Path, $Value) {
  [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 30) + "`n"), [Text.UTF8Encoding]::new($false))
}
function Get-QNHash([string]$Path) {
  # Reuse the package tests' .NET hashing boundary. A CMD launcher may inherit
  # PowerShell 7's module search path while running built-in Windows PowerShell.
  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $sha256.Dispose(); $stream.Dispose() }
}
function Get-QNFiles([string]$Root) {
  Assert-QNPlainPath $Root
  $queue = [Collections.Generic.Queue[string]]::new()
  $queue.Enqueue($Root)
  while ($queue.Count) {
    foreach ($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked folders or files are not supported: $($item.Name)" }
      if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
      else { $item }
    }
  }
}
function Test-QNPackage([string]$Root) {
  $validationTimer = [Diagnostics.Stopwatch]::StartNew()
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $actual = @(Get-QNFiles $rootPath)
  $inventoryPath = Join-Path $rootPath 'integrity.json'
  if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw 'The package inventory is missing. Fully extract the approved ZIP first.' }
  $inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
  if ($inventory.schemaVersion -ne 1 -or $inventory.files -isnot [array] -or $inventory.files.Count -eq 0) { throw 'Unsupported or empty package integrity inventory.' }
  $listed = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $inventory.files) {
    $relative = [string]$entry.path
    if ($relative -match '(^/|\\|:|[\x00-\x1f])' -or $relative -eq 'integrity.json' -or [string]::IsNullOrWhiteSpace($relative)) { throw 'An inventory path is invalid.' }
    foreach ($segment in $relative.Split('/')) {
      if (-not $segment -or $segment -in @('.', '..') -or $segment -match '[. ]$|[<>"|?*]' -or $segment -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)') { throw 'An inventory path is unsafe.' }
    }
    if ($listed.ContainsKey($relative)) { throw 'The inventory contains a duplicate path.' }
    if ($entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or $entry.size -is [string] -or $entry.size -lt 0 -or [decimal]$entry.size -ne [math]::Floor([decimal]$entry.size)) { throw 'An inventory hash or size is invalid.' }
    # Every segment was validated above and the complete tree was checked for
    # links before this loop. Re-walking every ancestor for every dependency
    # would make a normal launch needlessly slow.
    $path = Join-Path $rootPath $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "A packaged file is missing: $relative" }
    if ((Get-Item -LiteralPath $path).Length -ne $entry.size -or (Get-QNHash $path) -cne $entry.sha256) { throw "A packaged file has changed: $relative" }
    $listed.Add($relative, $entry)
  }
  foreach ($file in $actual) {
    $relative = $file.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
    if ($relative -ne 'integrity.json' -and -not $listed.ContainsKey($relative)) { throw "An unlisted file is present: $relative" }
  }
  if ($actual.Count -ne $listed.Count + 1) { throw 'The inventory does not match the extracted files.' }
  foreach ($required in @('manifest.json', 'runtime/node.exe', 'app/package.json', 'app/packages/server/bin/roughdraft.mjs', 'bin/Quick Notes.cmd', 'bin/roughdraft.cmd', 'bin/QuickNotes-Launch.ps1', 'bin/QuickNotes-Lifecycle.ps1', 'bin/Register-QuickNotesFileOpener.ps1', 'bin/Register Quick Notes.cmd', 'bin/Remove Quick Notes.cmd', 'Install-QuickNotes.ps1', 'Install Quick Notes.cmd', 'Rollback-QuickNotes.ps1', 'Rollback Quick Notes.cmd')) {
    if (-not $listed.ContainsKey($required)) { throw "Required package file missing: $required" }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $rootPath 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.product -cne 'IQ Wealth Quick Notes' -or $manifest.packageName -cne 'iq-wealth-quick-notes-runtime' -or $manifest.platform -cne 'win32' -or $manifest.architecture -cne 'x64' -or $manifest.nodeVersion -notmatch '^\d+\.\d+\.\d+$' -or $manifest.command -cne 'bin/Quick Notes.cmd' -or $manifest.agentCommand -cne 'bin/roughdraft.cmd') { throw 'This is not a supported Windows x64 Quick Notes package.' }
  Assert-QNVersion $manifest.version
  $app = Get-Content -LiteralPath (Join-Path $rootPath 'app/package.json') -Raw | ConvertFrom-Json
  if ($app.version -cne $manifest.version -or $app.name -cne $manifest.packageName) { throw 'The application and package versions do not match.' }
  $fingerprint = ($listed.Keys | Sort-Object | ForEach-Object { $entry = $listed[$_]; "$_|$($entry.size)|$($entry.sha256)" }) -join "`n"
  if ($env:THOUGHTFUL_SLOG_FILE) {
    [IO.File]::AppendAllText($env:THOUGHTFUL_SLOG_FILE, ((@{ ts = [DateTimeOffset]::UtcNow.ToString('o'); runId = $env:THOUGHTFUL_SLOG_RUN_ID; source = 'QuickNotes-Lifecycle.ps1'; event = 'windows-install.package-validated'; data = @{ version = $manifest.version; files = $listed.Count; elapsedMs = $validationTimer.ElapsedMilliseconds } } | ConvertTo-Json -Compress) + "`n"))
  }
  return [PSCustomObject]@{ Manifest = $manifest; Fingerprint = $fingerprint }
}
function Get-QNCurrent([string]$Root) {
  $path = Get-QNChild $Root 'current.json'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $current = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($current.schemaVersion -ne 1) { throw 'The installed version pointer is unsupported.' }
  Assert-QNVersion $current.version
  if ($null -eq $current.PSObject.Properties['previousVersion']) {
    # Recognise only the genuine pre-inventory managed pointer. This permits
    # migration, never execution or automatic rollback of its unverified files.
    $legacyRoot = Get-QNChild $Root ('versions/' + $current.version)
    if ($current.product -cne 'IQ Wealth Quick Notes' -or [IO.Path]::GetFullPath($current.path) -ne $legacyRoot -or $current.releaseTag -cne ('quick-notes-v' + $current.version) -or $current.sha256 -notmatch '^[0-9a-fA-F]{64}$' -or -not $current.installedAt) { throw 'The legacy installation pointer is not recognised.' }
    $legacyManifest = Get-Content -LiteralPath (Get-QNChild $legacyRoot 'manifest.json') -Raw | ConvertFrom-Json
    if ($legacyManifest.schemaVersion -ne 1 -or $legacyManifest.product -cne 'IQ Wealth Quick Notes' -or $legacyManifest.version -cne $current.version -or $legacyManifest.platform -cne 'win32' -or $legacyManifest.architecture -cne 'x64') { throw 'The legacy installation metadata does not match its pointer.' }
    $current | Add-Member -NotePropertyName previousVersion -NotePropertyValue $null
    $current | Add-Member -NotePropertyName legacyUnverified -NotePropertyValue $true
  }
  if ($null -ne $current.previousVersion) { Assert-QNVersion $current.previousVersion }
  return $current
}
function Get-QNFreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try { $listener.Start(); return $listener.LocalEndpoint.Port }
  finally { $listener.Stop() }
}
function Test-QNHealth([string]$VersionRoot, [string]$ScratchRoot, $Manifest) {
  $healthRoot = Get-QNChild $ScratchRoot ('health-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $healthRoot | Out-Null
  $saved = @{}
  # Health checks must never inherit a user's state file, remote binding, token,
  # frontend state, or Node injection flags. Only this isolated state is stopped.
  $names = @((Get-ChildItem Env: | Where-Object { $_.Name -like 'ROUGHDRAFT_*' } | ForEach-Object Name) + @('PORT', 'NODE_OPTIONS', 'NODE_PATH', 'IQ_QUICK_NOTES_MANAGED')) | Select-Object -Unique
  foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, $null) }
  $node = Join-Path $VersionRoot 'runtime/node.exe'
  $cli = Join-Path $VersionRoot 'app/packages/server/bin/roughdraft.mjs'
  $started = $false
  try {
    $env:ROUGHDRAFT_STATE_DIR = $healthRoot
    $env:ROUGHDRAFT_PORT = [string](Get-QNFreePort)
    $env:ROUGHDRAFT_NO_OPEN = '1'; $env:IQ_QUICK_NOTES_MANAGED = '1'
    $runtimeVersion = (& $node --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $runtimeVersion -cne ('v' + $Manifest.nodeVersion)) { throw 'The bundled runtime did not report its approved version.' }
    $version = (& $node $cli --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -cne $Manifest.version) { throw 'The installed application version check failed.' }
    Push-Location $healthRoot
    try { $output = & $node $cli start --json | Out-String }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'The isolated Quick Notes health process could not start.' }
    $status = $output | ConvertFrom-Json
    if (-not $status.running -or $status.reused -or -not $status.managed -or $status.stateFile -ne (Join-Path $healthRoot 'server.json')) { throw 'The health check did not create an isolated managed server.' }
    $started = $true
    $url = [Uri]$status.url
    if ($url.Scheme -ne 'http' -or $url.Host -notin @('localhost', '127.0.0.1') -or $url.Port -ne [int]$env:ROUGHDRAFT_PORT) { throw 'The health process is not on its isolated loopback port.' }
    $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 10 -Uri ([Uri]::new($url, '/api/health'))
    $details = Invoke-RestMethod -UseBasicParsing -TimeoutSec 10 -Uri ([Uri]::new($url, '/api/status'))
    $correctRoot = [IO.Path]::GetFullPath($details.serverRoot) -eq [IO.Path]::GetFullPath((Join-Path $VersionRoot 'app'))
    if ($env:THOUGHTFUL_SLOG_FILE) {
      [IO.File]::AppendAllText($env:THOUGHTFUL_SLOG_FILE, ((@{ ts = [DateTimeOffset]::UtcNow.ToString('o'); runId = $env:THOUGHTFUL_SLOG_RUN_ID; source = 'QuickNotes-Lifecycle.ps1'; event = 'windows-install.isolated-health'; data = @{ version = $Manifest.version; reused = $status.reused; correctRoot = $correctRoot; ownPid = ($health.pid -eq $status.pid); health = $health.status } } | ConvertTo-Json -Depth 5 -Compress) + "`n"))
    }
    if ($health.status -cne 'ok' -or $health.product -cne 'IQ Wealth Quick Notes' -or $health.pid -ne $status.pid -or -not $correctRoot) { throw 'The installed Quick Notes health response is invalid.' }
  } finally {
    if ($started) { & $node $cli stop --json | Out-Null }
    foreach ($name in @('ROUGHDRAFT_STATE_DIR', 'ROUGHDRAFT_PORT', 'ROUGHDRAFT_NO_OPEN')) { [Environment]::SetEnvironmentVariable($name, $null) }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    $safeHealth = Get-QNChild $ScratchRoot (Split-Path -Leaf $healthRoot)
    Remove-Item -LiteralPath $safeHealth -Recurse -Force
  }
}
function Set-QNCurrent([string]$Root, [string]$Version, $PreviousVersion) {
  $target = Get-QNChild $Root 'current.json'
  $temporary = Get-QNChild $Root ('current-' + [Guid]::NewGuid().ToString('N') + '.json')
  Write-QNJson $temporary ([ordered]@{ schemaVersion = 1; version = $Version; previousVersion = $PreviousVersion })
  try {
    # Windows PowerShell 5 converts $null to an empty string for this .NET
    # string parameter. NullString preserves the intended no-backup value.
    if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temporary, $target, [System.Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temporary, $target) }
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
function Initialise-QNRoot([string]$Root) {
  $full = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  if ($full -notmatch '^[A-Za-z]:\\.+\\.+' -or $full -in @($env:USERPROFILE, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), $env:LOCALAPPDATA, $env:TEMP)) { throw 'Choose a dedicated local Quick Notes installation folder.' }
  Assert-QNPlainPath $full
  $markerPath = Join-Path $full 'installation.json'
  if (Test-Path -LiteralPath $full) {
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw 'The installation path is not a folder.' }
    if (@(Get-ChildItem -LiteralPath $full -Force).Count -gt 0) {
      if (-not (Test-Path -LiteralPath $markerPath)) {
        $legacy = Get-QNCurrent $full
        if ($null -eq $legacy -or $null -eq $legacy.PSObject.Properties['legacyUnverified']) { throw 'The selected folder is not an existing managed installation or an empty folder.' }
      } else {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ($marker.schemaVersion -ne 1 -or $marker.product -cne 'IQ Wealth Quick Notes') { throw 'The selected installation marker is invalid.' }
      }
    }
  }
  New-Item -ItemType Directory -Path $full -Force | Out-Null
  if (-not (Test-Path -LiteralPath $markerPath)) { Write-QNJson $markerPath @{ schemaVersion = 1; product = 'IQ Wealth Quick Notes' } }
  foreach ($directory in @('versions', 'state', 'bin', 'staging')) { New-Item -ItemType Directory -Path (Get-QNChild $full $directory) -Force | Out-Null }
  return $full
}
function Initialise-QNVersionState([string]$Root, [string]$Version) {
  Assert-QNVersion $Version
  $state = Get-QNChild $Root "state/$Version"
  New-Item -ItemType Directory -Path $state -Force | Out-Null
  $path = Get-QNChild $state 'managed.json'
  if (Test-Path -LiteralPath $path) {
    $settings = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($settings.schemaVersion -ne 1 -or $settings.version -cne $Version -or $settings.port -isnot [int] -or $settings.port -lt 1024 -or $settings.port -gt 65535) { throw 'The managed version port is invalid.' }
  } else {
    $used = @(Get-ChildItem -LiteralPath (Join-Path $Root 'state') -Directory | ForEach-Object {
      $existing = Get-QNChild $_.FullName 'managed.json'
      if (Test-Path -LiteralPath $existing) { (Get-Content -LiteralPath $existing -Raw | ConvertFrom-Json).port }
    })
    do { $port = Get-QNFreePort } while ($port -in $used)
    $settings = [PSCustomObject]@{ schemaVersion = 1; version = $Version; port = $port }
    Write-QNJson $path $settings
  }
  return $settings
}
function Add-QNShortcuts([string]$Root) {
  $folder = Join-Path ([Environment]::GetFolderPath('Programs')) 'IQ Wealth/Quick Notes'
  Assert-QNPlainPath $folder
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  foreach ($entry in @(@('IQ Wealth Quick Notes', ''), @('New Quick Note', '--new'), @('Quick Notes Help', '--help-quick-notes'))) {
    $shortcut = $shell.CreateShortcut((Join-Path $folder ($entry[0] + '.lnk')))
    $shortcut.TargetPath = Join-Path $Root 'bin/Quick Notes.cmd'
    $shortcut.Arguments = $entry[1]
    $shortcut.WorkingDirectory = [Environment]::GetFolderPath('MyDocuments')
    $shortcut.Description = 'IQ Wealth Quick Notes'
    $shortcut.Save()
  }
}
