[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Exercise the actual package-builder deployment function in isolated native
# processes. Reverting it to legacy hoisted deploy makes the broken-lock cases
# succeed and therefore fails this regression test. No user store is removed.
$repo = Split-Path -Parent $PSScriptRoot
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('qn-lock-regression-' + [Guid]::NewGuid().ToString('N'))
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$tokens = $null; $parseErrors = $null
$builder = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'package-windows.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'The package builder has PowerShell syntax errors.' }
$definitions = foreach ($name in @('Invoke-CheckedCommand', 'Invoke-LockedRuntimeDeployment')) {
  $definition = $builder.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $false)
  if ($null -eq $definition) { throw "The package builder is missing its deployment function: $name" }
  $definition.Extent.Text
}
$compare = @'
const fs = require('node:fs'); const path = require('node:path');
const [repo, target] = process.argv.slice(1);
const yaml = require(require.resolve('yaml', {paths: [path.join(repo, 'packages/rfm')]}));
const source = yaml.parse(fs.readFileSync(path.join(repo, 'pnpm-lock.yaml'), 'utf8'));
const deployed = yaml.parse(fs.readFileSync(path.join(target, 'node_modules/.pnpm/lock.yaml'), 'utf8'));
const registry = Object.entries(deployed.packages).filter(([key]) => !key.includes('@file:'));
if (!registry.length) throw Error('The deployed runtime has no registry dependencies.');
for (const [key, value] of registry) {
  if (!source.packages[key] || JSON.stringify(source.packages[key].resolution) !== JSON.stringify(value.resolution)) throw Error('Unreviewed dependency resolution: ' + key);
}
let installed = 0;
function checkModules(root) {
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw Error('Not portable: ' + file);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) { checkModules(file); continue; }
    const manifest = JSON.parse(fs.readFileSync(path.join(file, 'package.json'), 'utf8'));
    if (!manifest.name.startsWith('@roughdraft/')) {
      if (!source.packages[manifest.name + '@' + manifest.version]) throw Error('Unreviewed installed package: ' + manifest.name + '@' + manifest.version);
      installed++;
    }
    if (fs.existsSync(path.join(file, 'node_modules'))) checkModules(path.join(file, 'node_modules'));
  }
}
checkModules(path.join(target, 'node_modules'));
const rfm = JSON.parse(fs.readFileSync(path.join(target, 'node_modules/@roughdraft/rfm/package.json'), 'utf8'));
if (rfm.name !== '@roughdraft/rfm') throw Error('The local RFM package was not deployed.');
console.log(JSON.stringify({registryPackages: registry.length, installedPackages: installed, localRfm: true, allMatchReviewedLock: true, portable: true}));
'@
try {
  New-Item -ItemType Directory -Path $scratch | Out-Null
  foreach ($case in @('valid', 'missing-lock', 'missing-snapshot', 'tampered-integrity')) {
    $caseRoot = Join-Path $scratch $case
    $workspace = Join-Path $caseRoot 'workspace'
    $target = Join-Path $caseRoot 'app'
    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
    foreach ($file in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) { Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $workspace }
    foreach ($name in @('app', 'server', 'rfm')) {
      $directory = Join-Path $workspace "packages/$name"
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
      Copy-Item -LiteralPath (Join-Path $repo "packages/$name/package.json") -Destination $directory
      Copy-Item -LiteralPath (Join-Path $repo "packages/$name/dist") -Destination $directory -Recurse
    }
    $lockPath = Join-Path $workspace 'pnpm-lock.yaml'
    $original = [IO.File]::ReadAllText($lockPath)
    $expectedError = $null
    switch ($case) {
      'missing-lock' {
        Remove-Item -LiteralPath $lockPath
        $expectedError = 'reviewed dependency lockfile is missing'
      }
      'missing-snapshot' {
        $broken = $original.Replace('  accepts@2.0.0:', '  accepts@0.0.0:')
        if ($broken -eq $original) { throw 'The dependency fixture changed; select a current runtime dependency.' }
        [IO.File]::WriteAllText($lockPath, $broken)
        $expectedError = 'ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY'
      }
      'tampered-integrity' {
        $broken = [regex]::Replace($original, '(?s)(  accepts@2\.0\.0:\s+resolution: \{integrity: )[^}]+', ('$1sha512-' + ('A' * 86) + '=='))
        if ($broken -eq $original) { throw 'The dependency integrity fixture changed.' }
        [IO.File]::WriteAllText($lockPath, $broken)
        $expectedError = 'ERR_PNPM_TARBALL_INTEGRITY'
      }
    }
    $runnerPath = Join-Path $caseRoot 'run-deployment.ps1'
    $outPath = Join-Path $caseRoot 'stdout.txt'; $errPath = Join-Path $caseRoot 'stderr.txt'
    # These limits are local to the test child, not settings for release builds.
    $runner = @'
$ErrorActionPreference = 'Stop'
$env:pnpm_config_fetch_retries = '0'
$env:pnpm_config_fetch_timeout = '10000'
'@
    $runner += "`n" + ($definitions -join "`n")
    $runner += "`nInvoke-LockedRuntimeDeployment -Workspace '" + $workspace.Replace("'", "''") + "' -Target '" + $target.Replace("'", "''") + "'`n"
    [IO.File]::WriteAllText($runnerPath, $runner, [Text.UTF8Encoding]::new($false))
    $process = Start-Process -FilePath $powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $runnerPath + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput $outPath -RedirectStandardError $errPath
    # Keep the native handle open: Windows PowerShell 5 otherwise sometimes
    # loses ExitCode after an asynchronously started process has terminated.
    $null = $process.Handle
    if (-not $process.WaitForExit(90000)) {
      # This PID belongs to the child just started above. Stop its complete test
      # process tree before cleaning the test's temporary workspace.
      & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $process.Id /T /F | Out-Null
      $process.WaitForExit()
      throw "The $case deployment exceeded its 90-second test limit."
    }
    $exitCode = $process.ExitCode
    $output = [IO.File]::ReadAllText($outPath) + [IO.File]::ReadAllText($errPath)
    if ($case -eq 'valid') {
      if ($exitCode -ne 0) { throw "The valid locked deployment failed: $output" }
      & node -e $compare $repo $target
      if ($LASTEXITCODE -ne 0) { throw 'The deployed runtime differs from the reviewed lockfile.' }
    } elseif ($exitCode -eq 0 -or $output -notmatch $expectedError) {
      throw "The $case deployment did not reject the broken lock for the expected reason: $output"
    }
    if ($output -match 'current configuration prohibits to read or write a lockfile') { throw 'Deployment disabled the lockfile.' }
    if ($env:THOUGHTFUL_SLOG_FILE) {
      $record = @{ ts = [DateTimeOffset]::UtcNow.ToString('o'); source = 'scripts/test-windows-package-lock.ps1'; event = ('package-lock.' + $case); data = @{ exitCode = $exitCode; passed = $true } }
      [IO.File]::AppendAllText($env:THOUGHTFUL_SLOG_FILE, (($record | ConvertTo-Json -Compress -Depth 5) + "`n"))
    }
    Write-Output "PASS: $case locked deployment."
  }
} finally {
  $resolved = [IO.Path]::GetFullPath($scratch)
  $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\qn-lock-regression-'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
