[CmdletBinding()]
param([string]$PackagePath = '', [switch]$Fixture, [switch]$LegacyFixture, [switch]$PointerOnly, [switch]$LaunchOnly, [switch]$DefaultSource = $true)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# These OS-boundary tests deliberately trade speed for real copy, process, port
# and command-line behaviour. They never register an opener or create shortcuts.
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Json($Path, $Value) {
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
}
function Inventory($Root) {
  $files = @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Where-Object { $_.FullName -ne (Join-Path $Root 'integrity.json') } | ForEach-Object {
    @{ path = $_.FullName.Substring($Root.Length + 1).Replace('\', '/'); size = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  Write-Json (Join-Path $Root 'integrity.json') @{ schemaVersion = 1; files = $files }
}
function Trace($Event, $Data) {
  if ($env:THOUGHTFUL_SLOG_FILE) {
    [IO.File]::AppendAllText($env:THOUGHTFUL_SLOG_FILE, ((@{ ts = [DateTimeOffset]::UtcNow.ToString('o'); runId = $env:THOUGHTFUL_SLOG_RUN_ID; source = 'scripts/test-windows-install.ps1'; event = $Event; data = $Data } | ConvertTo-Json -Compress) + "`n"))
  }
}
function Invoke-BoundedLauncher([string[]]$Arguments) {
  # The child intentionally uses a native captured CMD call, matching client
  # and agent use. Supervise it externally so a leaked pipe fails in 30 seconds.
  $runner = Join-Path $scratch 'captured-launch.ps1'
  [IO.File]::WriteAllText($runner, '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); & $args[0] @($args | Select-Object -Skip 1) 2>&1 | Out-String; exit $LASTEXITCODE')
  $engine = (Get-Process -Id $PID).Path
  $commandArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner) + $Arguments
  $quoted = @($commandArgs | ForEach-Object { '"' + [regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"' })
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $engine
  $start.Arguments = $quoted -join ' '
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.RedirectStandardInput = $true
  $start.StandardOutputEncoding = [Text.Encoding]::UTF8
  $start.StandardErrorEncoding = [Text.Encoding]::UTF8
  $process = [Diagnostics.Process]::Start($start)
  try {
    $process.StandardInput.WriteLine()
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    Assert ($process.WaitForExit(30000)) 'The captured launcher did not exit within 30 seconds.'
    Assert ($stdout.Wait(1000) -and $stderr.Wait(1000)) 'A detached server retained the captured launcher output pipe.'
    return [PSCustomObject]@{ ExitCode = $process.ExitCode; Output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult() }
  } finally {
    if (-not $process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
}
$repo = Split-Path -Parent $PSScriptRoot
if (-not $PackagePath) {
  $version = (Get-Content -LiteralPath (Join-Path $repo 'packaging/windows-package.json') -Raw | ConvertFrom-Json).version
  $PackagePath = Join-Path $repo "artifacts/IQ-Wealth-Quick-Notes-$version-win-x64.zip"
}
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('quick-notes-lifecycle-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $scratch 'Extracted package with spaces'
$installed = Join-Path $scratch 'Managed installation with spaces'
$ps = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$savedEnvironment = @{}
foreach ($name in @('PATH', 'ROUGHDRAFT_PORT', 'PORT', 'ROUGHDRAFT_STATE_DIR', 'ROUGHDRAFT_STATE_FILE', 'ROUGHDRAFT_NO_OPEN')) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
$defaultBefore = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice' -ErrorAction SilentlyContinue | Select-Object ProgId, Hash | ConvertTo-Json -Compress
$ownedStates = @()
try {
  New-Item -ItemType Directory -Path $source -Force | Out-Null
  if ($PointerOnly) {
    . (Join-Path $repo 'packaging/windows/QuickNotes-Lifecycle.ps1')
    Set-QNCurrent $source '0.1.2' $null
    Set-QNCurrent $source '0.2.0' '0.1.2'
    $replaced = Get-Content -LiteralPath (Join-Path $source 'current.json') -Raw | ConvertFrom-Json
    Assert ($replaced.version -eq '0.2.0' -and $replaced.previousVersion -eq '0.1.2') 'Atomic pointer replacement did not activate the update and retain its predecessor.'
    Trace 'windows-install.atomic-pointer-replaced' @{ passed = $true }
    Write-Output 'Atomic pointer creation and replacement passed.'
    return
  }
  if (Test-Path -LiteralPath $PackagePath -PathType Container) { Get-ChildItem -LiteralPath $PackagePath -Force | Copy-Item -Destination $source -Recurse }
  else { Expand-Archive -LiteralPath $PackagePath -DestinationPath $source }
  if ($Fixture) {
    Get-ChildItem -LiteralPath (Join-Path $repo 'packaging/windows') -File | Copy-Item -Destination (Join-Path $source 'bin') -Force
    if (Test-Path -LiteralPath (Join-Path $repo 'packaging/installer')) { Get-ChildItem -LiteralPath (Join-Path $repo 'packaging/installer') -File | Copy-Item -Destination $source -Force }
    Inventory $source
  }
  $installer = Join-Path $source 'Install-QuickNotes.ps1'
  Assert (Test-Path -LiteralPath $installer) 'Managed installer is missing: clients cannot install a verified version.'
  $manifestPath = Join-Path $source 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $originalVersion = $manifest.version
  $legacyPointer = $null
  if ($LegacyFixture) {
    $legacyRoot = Join-Path $installed 'versions/0.1.1'
    New-Item -ItemType Directory -Path $legacyRoot -Force | Out-Null
    Write-Json (Join-Path $legacyRoot 'manifest.json') @{ schemaVersion = 1; product = 'IQ Wealth Quick Notes'; version = '0.1.1'; platform = 'win32'; architecture = 'x64' }
    [IO.File]::WriteAllText((Join-Path $legacyRoot 'old-file.txt'), 'Retain legacy files without executing them.')
    Write-Json (Join-Path $installed 'current.json') @{ schemaVersion = 1; product = 'IQ Wealth Quick Notes'; version = '0.1.1'; path = $legacyRoot; releaseTag = 'quick-notes-v0.1.1'; sha256 = ('0' * 64); installedAt = '2026-08-12T17:40:00+08:00' }
    $legacyPointer = Get-Content -LiteralPath (Join-Path $installed 'current.json') -Raw
  }
  $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
  $env:ROUGHDRAFT_PORT = $null; $env:PORT = $null; $env:ROUGHDRAFT_STATE_DIR = $null; $env:ROUGHDRAFT_STATE_FILE = $null; $env:ROUGHDRAFT_NO_OPEN = '1'
  Assert ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) 'A system Node.js executable leaked into the test PATH.'
  function Install-Package {
    $ErrorActionPreference = 'Continue'
    $output = if ($DefaultSource) {
      & $ps -NoProfile -ExecutionPolicy Bypass -File $installer -InstallRoot $installed -NoRegistration -NoShortcuts 2>&1 | Out-String
    } else {
      & $ps -NoProfile -ExecutionPolicy Bypass -File $installer -PackageRoot $source -InstallRoot $installed -NoRegistration -NoShortcuts 2>&1 | Out-String
    }
    $ErrorActionPreference = 'Stop'
    Assert ($LASTEXITCODE -eq 0) "Installation failed: $output"
  }
  Install-Package
  $pointerPath = Join-Path $installed 'current.json'
  $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
  Assert ($pointer.version -eq $originalVersion) 'Fresh install did not activate the packaged version.'
  if ($LegacyFixture) {
    Assert ($null -eq $pointer.previousVersion) 'An unverified legacy version was offered as automatic rollback.'
    Assert ((Get-Content -LiteralPath (Join-Path $installed 'legacy-current.json') -Raw) -eq $legacyPointer) 'The original legacy pointer was not preserved exactly.'
    Assert ((Get-Content -LiteralPath (Join-Path $installed 'versions/0.1.1/old-file.txt') -Raw) -eq 'Retain legacy files without executing them.') 'Legacy files were changed.'
    Trace 'windows-install.legacy-preserved' @{ passed = $true; automaticRollbackToLegacy = $false }
  }
  $initialPointer = Get-Content -LiteralPath $pointerPath -Raw
  Install-Package
  Assert ((Get-Content -LiteralPath $pointerPath -Raw) -eq $initialPointer) 'Repeat install changed the current pointer.'
  $friendlyInstall = Invoke-BoundedLauncher @((Join-Path $source 'Install Quick Notes.cmd'), '-InstallRoot', $installed, '-NoRegistration', '-NoShortcuts')
  Assert ($friendlyInstall.ExitCode -eq 0) "The friendly installer failed without a PackageRoot argument: $($friendlyInstall.Output)"
  Assert ((Get-Content -LiteralPath $pointerPath -Raw) -eq $initialPointer) 'The friendly repeat installer changed the current pointer.'
  Trace 'windows-install.fresh-repeat' @{ version = $originalVersion; passed = $true }

  if (-not $LaunchOnly) {
  $inventoryPath = Join-Path $source 'integrity.json'
  $originalInventory = Get-Content -LiteralPath $inventoryPath -Raw
  $originalManifest = Get-Content -LiteralPath $manifestPath -Raw
  # Removing validation must make each adversarial package activate or succeed.
  foreach ($case in @('tamper', 'missing', 'unlisted', 'traversal', 'absolute', 'duplicate', 'schema', 'product', 'version', 'platform', 'symlink', 'same-version-different-content')) {
    $probe = Join-Path $source 'unexpected.txt'
    $renamed = Join-Path $scratch 'saved-manifest.json'
    try {
      $inv = $originalInventory | ConvertFrom-Json
      switch ($case) {
        tamper { [IO.File]::AppendAllText($manifestPath, ' ') }
        missing { Move-Item -LiteralPath $manifestPath -Destination $renamed }
        unlisted { [IO.File]::WriteAllText($probe, 'not inventoried') }
        traversal { $inv.files[0].path = '../outside.txt'; Write-Json $inventoryPath $inv }
        absolute { $inv.files[0].path = 'C:/outside.txt'; Write-Json $inventoryPath $inv }
        duplicate { $inv.files += $inv.files[0]; Write-Json $inventoryPath $inv }
        schema { $inv.schemaVersion = 99; Write-Json $inventoryPath $inv }
        product { $bad = $originalManifest | ConvertFrom-Json; $bad.product = 'Another product'; Write-Json $manifestPath $bad; Inventory $source }
        version { $bad = $originalManifest | ConvertFrom-Json; $bad.version = '../escape'; Write-Json $manifestPath $bad; Inventory $source }
        platform { $bad = $originalManifest | ConvertFrom-Json; $bad.platform = 'linux'; Write-Json $manifestPath $bad; Inventory $source }
        symlink { New-Item -ItemType Junction -Path (Join-Path $source 'linked-directory') -Target $scratch | Out-Null }
        same-version-different-content { [IO.File]::WriteAllText($probe, 'Changed contents with a valid inventory.'); Inventory $source }
      }
      $ErrorActionPreference = 'Continue'
      $failure = & $ps -NoProfile -ExecutionPolicy Bypass -File $installer -PackageRoot $source -InstallRoot $installed -NoRegistration -NoShortcuts 2>&1 | Out-String
      $ErrorActionPreference = 'Stop'
      Assert ($LASTEXITCODE -ne 0) "Unsafe package was accepted: $case ($failure)"
      Assert ((Get-Content -LiteralPath $pointerPath -Raw) -eq $initialPointer) "Rejected $case package changed current.json."
      Trace 'windows-install.rejected' @{ case = $case; currentUnchanged = $true }
    } finally {
      if (Test-Path -LiteralPath (Join-Path $source 'linked-directory')) { [IO.Directory]::Delete((Join-Path $source 'linked-directory')) }
      if (Test-Path -LiteralPath $renamed) { Move-Item -LiteralPath $renamed -Destination $manifestPath }
      if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe }
      [IO.File]::WriteAllText($manifestPath, $originalManifest, [Text.UTF8Encoding]::new($false))
      [IO.File]::WriteAllText($inventoryPath, $originalInventory, [Text.UTF8Encoding]::new($false))
    }
  }
  $cliPath = Join-Path $source 'app/packages/server/bin/roughdraft.mjs'
  $appPackagePath = Join-Path $source 'app/package.json'
  $originalCli = Get-Content -LiteralPath $cliPath -Raw
  $originalAppPackage = Get-Content -LiteralPath $appPackagePath -Raw
  try {
    $unhealthyManifest = $originalManifest | ConvertFrom-Json
    $unhealthyManifest.version = '999.0.0'
    Write-Json $manifestPath $unhealthyManifest
    $unhealthyApp = $originalAppPackage | ConvertFrom-Json
    $unhealthyApp.version = '999.0.0'
    Write-Json $appPackagePath $unhealthyApp
    [IO.File]::WriteAllText($cliPath, "if (process.argv.includes('--version')) console.log('999.0.0'); else process.exit(73);`n")
    Inventory $source
    $ErrorActionPreference = 'Continue'
    $failedHealth = & $ps -NoProfile -ExecutionPolicy Bypass -File $installer -PackageRoot $source -InstallRoot $installed -NoRegistration -NoShortcuts 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
    Assert ($LASTEXITCODE -ne 0) "An unhealthy runtime was activated: $failedHealth"
    Assert ((Get-Content -LiteralPath $pointerPath -Raw) -eq $initialPointer) 'Failed health check changed the current version.'
    Trace 'windows-install.failed-health-preserved-current' @{ passed = $true }
  } finally {
    [IO.File]::WriteAllText($cliPath, $originalCli, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($appPackagePath, $originalAppPackage, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($manifestPath, $originalManifest, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($inventoryPath, $originalInventory, [Text.UTF8Encoding]::new($false))
  }
  }
  $note = Join-Path $scratch "Client Notes/Pension review & income $([char]0x2013) caf$([char]0xe9).md"
  New-Item -ItemType Directory -Path (Split-Path -Parent $note) -Force | Out-Null
  [IO.File]::WriteAllText($note, "# Pension review`n`nPreserve these client notes.`n")
  $noteHash = (Get-FileHash -LiteralPath $note).Hash
  $friendly = Join-Path $installed 'bin/Quick Notes.cmd'
  $agent = Join-Path $installed 'bin/roughdraft.cmd'
  $agentVersion = (& $agent --version | Out-String).Trim()
  Assert ($LASTEXITCODE -eq 0 -and $agentVersion -eq $originalVersion) 'Stable agent launcher did not use the bundled current version.'
  $ownedStates += $originalVersion
  $agentStarted = Invoke-BoundedLauncher @($agent, 'start', '--json')
  Assert ($agentStarted.ExitCode -eq 0) "Stable agent start failed: $($agentStarted.Output)"
  $agentStatus = $agentStarted.Output | ConvertFrom-Json
  Assert ($agentStatus.running -and (Invoke-RestMethod -UseBasicParsing -TimeoutSec 10 -Uri ([Uri]::new([Uri]$agentStatus.url, '/api/health'))).pid -eq $agentStatus.pid) 'The agent start returned without a live managed server.'
  $agentStopped = Invoke-BoundedLauncher @($agent, 'stop', '--json')
  Assert ($agentStopped.ExitCode -eq 0) "The test could not stop its own agent-started server: $($agentStopped.Output)"
  $launchTimer = [Diagnostics.Stopwatch]::StartNew()
  $openedCommand = Invoke-BoundedLauncher @($friendly, $note, '--no-open', '--json')
  $openedText = $openedCommand.Output
  $launchTimer.Stop()
  Assert ($launchTimer.Elapsed.TotalSeconds -lt 30) 'The friendly launcher waited for the detached server instead of returning within 30 seconds.'
  Assert ($openedCommand.ExitCode -eq 0) "Stable full-path opener failed: $openedText"
  $opened = $openedText | ConvertFrom-Json
  Assert ($opened.path -eq $note -and $opened.openMode -eq 'disabled') 'Stable launcher lost the full spaced note path or opened a browser.'
  Trace 'windows-install.stable-launch' @{ passed = $true; elapsedMs = $launchTimer.ElapsedMilliseconds; serverUrl = $opened.serverUrl }
  $oldHealth = Invoke-RestMethod -UseBasicParsing -TimeoutSec 10 -Uri ($opened.serverUrl + '/api/health')
  $managed = Get-Content -LiteralPath (Join-Path $installed "state/$originalVersion/managed.json") -Raw | ConvertFrom-Json
  Assert ($managed.port -eq ([Uri]$opened.serverUrl).Port) 'Stable launch did not use its per-version port.'
  if ($LaunchOnly) {
    [PSCustomObject]@{ result = 'passed'; version = $originalVersion; launchMs = $launchTimer.ElapsedMilliseconds; serverStillRunning = $true; powerShellVersion = $PSVersionTable.PSVersion.ToString(); systemNodeRequired = $false } | ConvertTo-Json
    return
  }

  # A synthetic next release reuses the real executable, with coherent package
  # metadata. This verifies lifecycle mechanics, not a second app build.
  $nextVersion = '999.0.1'
  $manifest.version = $nextVersion
  Write-Json $manifestPath $manifest
  $appPackagePath = Join-Path $source 'app/package.json'
  $appPackage = Get-Content -LiteralPath $appPackagePath -Raw | ConvertFrom-Json
  $appPackage.version = $nextVersion
  Write-Json $appPackagePath $appPackage
  Inventory $source
  Install-Package
  $upgraded = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
  Assert ($upgraded.version -eq $nextVersion -and $upgraded.previousVersion -eq $originalVersion) 'Upgrade did not retain the previous version.'
  Assert ((Invoke-RestMethod -UseBasicParsing -TimeoutSec 10 -Uri ($opened.serverUrl + '/api/health')).pid -eq $oldHealth.pid) 'Upgrade stopped or replaced the older open session.'
  $ownedStates += $nextVersion
  $updatedCommand = Invoke-BoundedLauncher @($friendly, $note, '--no-open', '--json')
  $newText = $updatedCommand.Output
  Assert ($updatedCommand.ExitCode -eq 0) "Updated launcher failed: $newText"
  $newOpen = $newText | ConvertFrom-Json
  Assert ($newOpen.serverUrl -ne $opened.serverUrl) 'Upgrade reused the older server port.'
  $retainedManifest = Join-Path $installed "versions/$originalVersion/manifest.json"
  $retainedText = Get-Content -LiteralPath $retainedManifest -Raw
  $beforeRollback = Get-Content -LiteralPath $pointerPath -Raw
  try {
    [IO.File]::AppendAllText($retainedManifest, ' ')
    $ErrorActionPreference = 'Continue'
    $badRollback = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installed 'Rollback-QuickNotes.ps1') -InstallRoot $installed 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
    Assert ($LASTEXITCODE -ne 0) "Rollback accepted an altered previous version: $badRollback"
    Assert ((Get-Content -LiteralPath $pointerPath -Raw) -eq $beforeRollback) 'Rejected rollback changed current.json.'
    Trace 'windows-install.rejected-altered-rollback' @{ passed = $true }
  } finally { [IO.File]::WriteAllText($retainedManifest, $retainedText, [Text.UTF8Encoding]::new($false)) }
  $rollback = & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installed 'Rollback-QuickNotes.ps1') -InstallRoot $installed 2>&1 | Out-String
  Assert ($LASTEXITCODE -eq 0) "Rollback failed: $rollback"
  Assert ((Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json).version -eq $originalVersion) 'Rollback did not restore the verified previous version.'
  Assert ((Get-FileHash -LiteralPath $note).Hash -eq $noteHash) 'Install/update/rollback modified client notes.'
  $defaultAfter = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice' -ErrorAction SilentlyContinue | Select-Object ProgId, Hash | ConvertTo-Json -Compress
  Assert ($defaultBefore -eq $defaultAfter) 'The Markdown default application changed.'
  Trace 'windows-install.upgrade-rollback' @{ passed = $true; preservedOpenSession = $true; systemNodeRequired = $false }
  [PSCustomObject]@{ result = 'passed'; version = $originalVersion; rejectionCases = 12; failedHealthPreservedCurrent = $true; rejectedAlteredRollback = $true; fresh = $true; repeat = $true; update = $true; rollback = $true; preservedOpenSession = $true; preservedNotes = $true; markdownDefaultChanged = $false; systemNodeRequired = $false } | ConvertTo-Json
} finally {
  foreach ($version in $ownedStates) {
    $env:ROUGHDRAFT_STATE_DIR = Join-Path $installed "state/$version/server"
    $env:ROUGHDRAFT_PORT = [string](Get-Content -LiteralPath (Join-Path $installed "state/$version/managed.json") -Raw | ConvertFrom-Json).port
    & (Join-Path $installed "versions/$version/runtime/node.exe") (Join-Path $installed "versions/$version/app/packages/server/bin/roughdraft.mjs") stop --json | Out-Null
  }
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name]) }
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  Assert ([IO.Path]::GetFullPath($scratch).StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) 'Unsafe test cleanup path.'
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
