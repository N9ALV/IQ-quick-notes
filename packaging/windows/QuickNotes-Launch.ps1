# Remaining CLI flags belong to Roughdraft, not PowerShell's parameter binder.
# Use argument arrays at the Node boundary, never executable shell text.
param([ValidateSet('Friendly', 'Agent')][string]$Mode = 'Friendly')
$forward = @($args)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'QuickNotes-Lifecycle.ps1')
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
  $current = Get-QNCurrent $root
  if ($null -ne $current) {
    $versionRoot = Get-QNChild $root ('versions/' + $current.version)
    $package = Test-QNPackage $versionRoot
    if ($package.Manifest.version -cne $current.version) { throw 'The current version pointer does not match the installed package.' }
    $settings = Initialise-QNVersionState $root $current.version
    if ([string]::IsNullOrWhiteSpace($env:ROUGHDRAFT_STATE_DIR) -and [string]::IsNullOrWhiteSpace($env:ROUGHDRAFT_STATE_FILE)) { $env:ROUGHDRAFT_STATE_DIR = Get-QNChild $root ('state/' + $current.version + '/server') }
    if ([string]::IsNullOrWhiteSpace($env:ROUGHDRAFT_PORT) -and [string]::IsNullOrWhiteSpace($env:PORT)) { $env:ROUGHDRAFT_PORT = [string]$settings.port }
  } else {
    if (Test-Path -LiteralPath (Join-Path $root 'installation.json')) { throw 'The managed installation has no active version. Run the approved installer again.' }
    $versionRoot = $root
    $package = Test-QNPackage $versionRoot
  }
  $env:IQ_QUICK_NOTES_MANAGED = '1'
  $node = Join-Path $versionRoot 'runtime/node.exe'
  $cli = Join-Path $versionRoot 'app/packages/server/bin/roughdraft.mjs'
  if ($Mode -eq 'Agent') { & $node $cli @forward; exit $LASTEXITCODE }
  if ($forward.Count -gt 0 -and $forward[0] -eq '--help-quick-notes') {
    Start-Process -FilePath 'https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/'
    exit 0
  }
  $newNote = $forward.Count -gt 0 -and $forward[0] -eq '--new'
  if ($forward.Count -eq 0 -or $newNote) {
    if ($env:ROUGHDRAFT_NO_OPEN -eq '1') { throw 'Choose a Markdown file explicitly when browser and dialog opening is disabled.' }
    Add-Type -AssemblyName System.Windows.Forms
    if ($newNote) {
      $dialog = New-Object System.Windows.Forms.SaveFileDialog
      $dialog.Title = 'Create a new Quick Note'
      $dialog.FileName = 'New Quick Note.md'
      $dialog.OverwritePrompt = $true
    } else {
      $dialog = New-Object System.Windows.Forms.OpenFileDialog
      $dialog.Title = 'Choose a Markdown note'
      $dialog.CheckFileExists = $true
    }
    try {
      $dialog.Filter = 'Markdown notes (*.md)|*.md'
      $dialog.DefaultExt = 'md'
      $dialog.AddExtension = $true
      if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
      $selected = $dialog.FileName
      if ([IO.Path]::GetExtension($selected) -ine '.md') { throw 'Please choose a file ending in .md.' }
      if ($newNote) { [IO.File]::WriteAllText($selected, "# New Quick Note`n`n", [Text.UTF8Encoding]::new($false)) }
      $forward = @($selected)
    } finally { $dialog.Dispose() }
  }
  if ($forward[0] -in @('--help', '-h')) { & $node $cli open --help; exit $LASTEXITCODE }
  $file = [IO.Path]::GetFullPath($forward[0])
  $remaining = @($forward | Select-Object -Skip 1)
  $diagnostic = $remaining.Count -gt 0 -or $env:ROUGHDRAFT_NO_OPEN -eq '1'
  if ($diagnostic) {
    & $node $cli open $file --no-watch @remaining
    exit $LASTEXITCODE
  }
  # Preserve the complete document URL, including both projectPath and path.
  $output = & $node $cli open $file --print-url --no-watch | Out-String
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $url = $output.Trim()
  $parsed = [Uri]$url
  if (-not $parsed.IsAbsoluteUri -or $parsed.Scheme -ne 'http' -or $parsed.Host -notin @('localhost', '127.0.0.1')) { throw 'Quick Notes could not obtain a safe local document URL.' }
  Start-Process -FilePath $url
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
