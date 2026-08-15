# IQ Wealth Quick Notes 0.1.2

This maintenance release makes ordinary Windows file opens reliable when a
client moves between Markdown notes stored in different folders.

## Client improvement

- `Quick Notes.cmd` now asks the validated CLI for the complete document URL
  and passes that exact URL to Windows.
- The friendly **Open with** route preserves both the full folder and filename,
  including spaces, without asking a client to stop Quick Notes first.
- Diagnostic and agent commands retain their existing JSON, browser-suppression,
  remote-host, custom-state and custom-port behaviour.

## Technical clarification

The local server is intentionally stateless across note folders. Its
`/api/status.projectDir` field reports the folder used when that reusable
process first started; it is not the identity or access boundary for the note
currently named by the URL. The document URL's `projectPath` and `path`, plus
the Markdown file on disk, are authoritative.

The alternative pull-request approach—stopping the server before every managed
open—was not adopted. Besides stopping for help or invalid commands, it dropped
state/port overrides, interfered with remote mode and caused a bundled Windows
Node process failure during a real package handover.

## Acceptance coverage

- Published 0.1.1 package regression proving the friendly launcher did not yet
  request an exact URL.
- Actual packaged Windows runtime test with system Node.js removed from
  `PATH`.
- Two Markdown notes in different folders, with spaces in both paths.
- Exact second-note URL verification and a real API read of the second file's
  content through the reused stateless server.
- Existing package identity, checksum, registration, health and clean-stop
  checks.

GitHub Actions remained disabled; all validation was run locally on Windows.

## Published asset

- `IQ-Wealth-Quick-Notes-0.1.2-win-x64.zip` — 40,806,871 bytes
- SHA-256:
  `4a558492db28718c61e559f2c6d1daaf0c31c82fc6af1d84123654683a0c0f7e`

The same values are recorded in
[`updates/stable.json`](../../updates/stable.json).

## Verification results

- `pnpm check`: 372 unit/integration tests passed, with linting and production
  builds successful.
- `pnpm test:smoke`: 11 Chromium smoke tests passed.
- `pnpm test:package:win`: passed with the bundled runtime, HTTP 200, health
  `ok`, cross-folder content read, no system Node.js requirement and no
  Markdown-default change.
