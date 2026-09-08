# IQ Wealth managed installation and updates

Clients need neither developer tools nor GitHub. The authority for client
instructions and approved package links is the
[canonical IU Quick Notes Skill](https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/).
Use the client's ordinary signed-in IU session; never invent an agent download
token, entitlement or bypass. Skill Markdown and application ZIP are separate
downloads. Never substitute `npm i -g roughdraft`.

## Package and authenticity

Release 0.2.0 supports Windows x64 and includes Node.js 24.20.0. The ZIP is flat:

```text
Install Quick Notes.cmd            Friendly installer
Install-QuickNotes.ps1             Scriptable installer
Rollback Quick Notes.cmd           Select retained verified version
Rollback-QuickNotes.ps1
app/                              Compiled app and production dependencies
bin/Quick Notes.cmd               Friendly Windows opener
bin/roughdraft.cmd                 Agent compatibility command
bin/QuickNotes-Launch.ps1          Stable launch bridge
bin/QuickNotes-Lifecycle.ps1       Validation and lifecycle helpers
bin/Register Quick Notes.cmd      Optional Open with repair
bin/Remove Quick Notes.cmd        Remove only Quick Notes registration
runtime/node.exe                  Pinned runtime
runtime/NODE-LICENSE.txt
manifest.json                     Package identity
integrity.json                    Per-file size and SHA-256 inventory
NOTICE.md
THIRD-PARTY-LICENCES.txt
README.txt
```

Verify the ZIP's **complete SHA-256 and byte count** against the current IU
Skill before extracting or executing it. The inventory detects incomplete or
altered files; it is not a digital signature and cannot establish publisher
authenticity by itself. A checksum beside an untrusted ZIP is not approval.

## Real installation procedure

1. Obtain the latest Skill from the permanent IU page, preserving the client's
   configured preferences and approved note locations.
2. Download its exact Windows ZIP and checksum through normal IU access.
3. Verify both size and hash. On any mismatch, stop without running it.
4. Extract to a download/temporary folder, outside the managed installation.
5. Run the extracted **Install Quick Notes.cmd**, or invoke
   `Install-QuickNotes.ps1` directly with PowerShell.

The per-user installation needs no administrator rights:

```text
%LOCALAPPDATA%\IQ Wealth\Quick Notes\
  bin\                            Stable launchers and registration helpers
  versions\<version>\             Immutable verified package
  state\<version>\                Separate managed server state and port
  staging\                        Isolated installation health checks
  installation.json
  current.json                    Active and previous verified versions
  Rollback Quick Notes.cmd
```

The installer validates all files, rejects linked/traversing/unlisted content,
copies to a separate version, validates the copy and starts an isolated health
check with the bundled runtime. It selects the new version only after success
and does not stop an existing review session. Same-version reinstallation is
allowed only when contents match; it will not overwrite a different package
claiming the same version.

It registers the **stable** friendly opener and creates Start menu entries for
existing notes, new notes and canonical help. Registration never edits Windows'
protected `UserChoice` or removes VS Code. Default selection remains the
user's choice in Windows Default Apps.

For test/special-purpose installation, `-InstallRoot <absolute-folder>`,
`-NoRegistration` and `-NoShortcuts` are supported. Explain any deliberately
omitted integration rather than claiming a complete client installation.

## Stable commands and acceptance

```powershell
$quickNotesRoot = Join-Path $env:LOCALAPPDATA 'IQ Wealth\Quick Notes'
$quickNotes = Join-Path $quickNotesRoot 'bin\roughdraft.cmd'
& $quickNotes --version
& $quickNotes open 'C:\Client Notes\Review.md' --json --no-watch
```

Require the expected version, `opened: true`, correct full path, and returned
browser URL. Check `/api/health` using that result's server URL. Open a second
note from another folder; do not infer its location from the reusable server's
original `/api/status.projectDir`.

The friendly opener is `bin\Quick Notes.cmd "C:\full\path\note.md"`.
Without a file it offers a Windows file picker; `--new` offers a save dialog.
Keep stable launcher paths in the personalised Skill, not release-numbered
paths or a global public Roughdraft command.

## Updates, rollback and older installations

Finish existing reviews and wait for Saved. Download and verify the newly
approved package, then run its installer. Do not delete client notes or shared
state manually.

**Rollback Quick Notes.cmd** validates and health-checks the retained previous
managed version before selecting it. It does not force-close existing sessions.
No previous version, missing inventory, altered files or failed health means
rollback stops without changing the active pointer.

The installer recognises the earlier IQ-managed `current.json` layout only
when it matches its own version directory and manifest. It retains old files
and saves the exact old pointer as `legacy-current.json`. Older packages lack
an inventory, so they are **not** trusted one-click rollback targets. Legacy
recovery requires IQ Wealth to verify the original approved ZIP and deliberately
restore the corresponding installation. A saved pointer alone is not approval.

## Local build and verification

```powershell
pnpm install --frozen-lockfile
pnpm check
$env:PLAYWRIGHT_BROWSER_CHANNEL = 'msedge' # Optional installed-browser fallback
pnpm test:e2e --workers=4
pnpm test:smoke
pnpm audit
pnpm test:package:lock
pnpm package:win
pnpm test:package:win
pnpm test:install:win -- -PackagePath artifacts/IQ-Wealth-Quick-Notes-0.2.0-win-x64.zip
pnpm test:install:win -- -PackagePath artifacts/IQ-Wealth-Quick-Notes-0.2.0-win-x64.zip -LegacyFixture
```

The lifecycle test uses actual native Windows files, CMD, PowerShell, bundled
Node and HTTP. `-Fixture` augments an older ZIP for development; it must not
be used as final release evidence.

## Manual publication and canonical documentation

GitHub Actions must remain disabled. Do not create a branch or PR.

1. Complete local checks and independent review; build the final ZIP.
2. Set `updates/stable.json` to its exact identity, size and full hash.
3. Commit and push source and maintainer docs directly to `main`.
4. Publish the GitHub Release manually with ZIP and checksum.
5. Download the release asset and verify the exact bytes.
6. Follow the **current** Vault model: immutable binaries go to the private
   `iu-vault-content` R2 bucket with matching `vault_assets` metadata; edit
   the existing canonical Skill in `public.vault_documents`.
7. Verify asset delivery and the canonical Skill revision. Never publish
   proposed download links before their approved binary is available.

Supabase is the live Markdown authority. GitHub content mirrors, WorkDrive,
Contabo source folders and Baserow content tables are frozen migration/rollback
sources, not routine authoring targets. Do not restart old reconciliation jobs,
create companion Skill ZIPs/catalogues, or introduce another canonical article.
These repository guides are maintainer/reference docs pointing to the single
live client Skill, not a duplicate of its full content.
