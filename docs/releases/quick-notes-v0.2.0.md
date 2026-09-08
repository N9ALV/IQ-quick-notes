# IQ Wealth Quick Notes 0.2.0

This release improves client setup, Windows reliability, draft recovery and
local-file security. It remains a local Markdown companion based on Roughdraft,
not a Hubble clone or a new cloud note service.

## For clients and their agents

Use the [current IU instructions and downloads](https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/).
The **Windows application ZIP** and **Download page** Skill are different files.
Refresh the personalised Skill without losing client preferences, verify the
ZIP, finish open reviews and run its included **Install Quick Notes.cmd**.
No GitHub, npm, system Node.js or administrator rights are required.

The installer provides stable friendly launchers, Start menu entries, checked
updates and rollback to a retained verified managed version. It preserves
client notes, VS Code and the current Markdown default. Pre-0.2.0 installations
are retained for verified IQ Wealth-assisted recovery, not silently trusted as
automatic rollback targets.

## Improvements

- Practical IQ welcome page, clearly temporary practice note and larger
  reading text that does not modify the Markdown file.
- Copy/download of the latest draft even when saving is paused or fails;
  visible clipboard and attachment errors, and remote connection retry.
- Local API Host/Origin/peer checks and sandboxed active attachments. Practice
  rejects active SVG/HTML attachments rather than creating executable Blob URLs.
- Reliable hidden Windows background-server launch under both Windows
  PowerShell and PowerShell 7, including captured agent commands and full paths.
- Bundled Node.js 24.20.0, compatible dependency security patches, frozen
  lockfile deployment, complete package inventory and third-party notices.

## Package identity

- File: `IQ-Wealth-Quick-Notes-0.2.0-win-x64.zip`
- Platform: Windows x64
- Size: **41,201,706 bytes**
- SHA-256: `e8bf0bde2bd43d85fdd15a8ebe246648c2981caabe2494ee8c7feec672fc500f`

The detached `.sha256` and [stable manifest](../../updates/stable.json) contain
the same identity. The inventory is not a signature: verify the ZIP against the
approved source before running it.

## Local verification

- `pnpm check`: 427 tests, selector checks, lint error gate and all builds pass.
- `pnpm test:e2e --workers=2`: 30 Edge browser tests pass.
- `pnpm test:smoke --workers=2`: 12 smoke tests pass.
- `pnpm test:package:lock`: valid/missing/tampered-lock cases pass; installed
  registry versions and integrity values match the reviewed lock.
- `pnpm test:package:win`: exact ZIP passes with no system Node.js, complete
  paths in two folders, real content reads, healthy detached server and stop.
- `scripts/test-windows-install.ps1`: exact ZIP passes legacy migration,
  repeat installation, 12 unsafe-package cases, failed-health preservation,
  side-by-side update and verified rollback. Captured launch returns while its
  server remains healthy under Windows PowerShell 5.1 and PowerShell 7.6.4.
- Dependency audit: zero reported advisories at verification time.
- Actual per-user installation, Start menu targets, friendly full-path opening
  and unchanged VS Code default verified on this machine.

The [review record](../review-2026-09-08.md) explains upstream decisions,
reproductions, client feedback and remaining verification limits. Existing
non-blocking lint and large frontend-bundle warnings remain.

All work was performed locally on Windows and published directly on `main`.
No branches, pull requests or GitHub Actions/runs were used.
