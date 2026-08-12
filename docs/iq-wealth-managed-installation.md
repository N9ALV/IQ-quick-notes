# IQ Wealth managed installation and updates

## Client experience

Clients do not need Git, GitHub, Node.js, npm or pnpm. IQ Wealth downloads an
approved Windows release, verifies it, installs it under the client's local IQ
Wealth application directory and keeps it updated.

Do not run `npm i -g roughdraft`. That installs the public upstream package,
not IQ Wealth Quick Notes.

The application ZIP and the agent Skill are separate resources. The client
download must be the ZIP named below, never the Skill instruction file. If the
approved package is unavailable during maintenance, show a clear temporary
unavailability message instead of substituting another download.

## Release package

The Windows package is named:

```text
IQ-Wealth-Quick-Notes-<version>-win-x64.zip
```

The ZIP is flat. Extract it directly into the selected version directory:

```text
app/                              Compiled app and production dependencies
bin/Quick Notes.cmd               Friendly Windows Markdown opener
bin/roughdraft.cmd                Agent compatibility command
bin/Register Quick Notes.cmd      Safe per-user Open with registration
bin/Remove Quick Notes.cmd        Removes only Quick Notes registration
bin/Register-QuickNotesFileOpener.ps1
runtime/node.exe                  Pinned Node.js runtime
runtime/NODE-LICENSE.txt
manifest.json                     Machine-readable package identity
README.txt
```

There is no extra package-name folder inside the ZIP.

## Friendly Windows opener

For a person or a Windows file association, invoke:

```text
bin\Quick Notes.cmd "C:\complete\path\to\note.md"
```

The launcher resolves the selected file to an absolute path before calling the
internal CLI and returns after opening rather than holding a console window
open. This avoids the lost-folder error reported when Windows passed a filename
to `roughdraft.cmd` directly.

Run `bin\Register Quick Notes.cmd` once per user to add IQ Wealth Quick Notes
to Windows' **Open with** list and Default Apps screen. The script does not
replace the current `.md` default, edit Windows' protected `UserChoice`, or
remove VS Code. Windows remains responsible for the user's final default-app
choice. `bin\Remove Quick Notes.cmd` removes only Quick Notes' own registration.

## Agent command

Existing IQ Wealth workflows can continue to use the managed compatibility
launcher:

```text
bin\roughdraft.cmd open "C:\complete\path\to\note.md" --json --no-watch
```

Use the finite, replayable monitoring pattern in
[the agent guide](iq-wealth-agent-guide.md). Never point this launcher to a
globally installed npm package.

## Recommended installation layout

```text
%LOCALAPPDATA%\IQ Wealth\Quick Notes\
  versions\
    <version>\
      app\
      bin\
      runtime\
      manifest.json
      README.txt
  current.json
```

## Safe install and update procedure

1. Fetch the approved stable manifest over HTTPS.
2. Compare it with the installed `manifest.json`.
3. Download the exact ZIP and `.sha256` named by the manifest.
4. Verify both byte count and complete SHA-256 before extraction.
5. Extract directly to a new version directory; never overwrite the running
   version.
6. Validate `manifest.json`, `runtime\node.exe`, both launchers and the file
   association helper.
7. Run `bin\roughdraft.cmd --version`, start the app, and require
   `GET /api/health` to return `status: "ok"`.
8. Run the registration helper. It is safe to repeat and does not change the
   user's existing Markdown default.
9. Atomically replace `current.json` only after validation succeeds.
10. Keep the previous approved version for rollback.

If any check fails, leave the installed version unchanged and report a simple
maintenance error. Do not direct a client to npm or GitHub as a fallback.

## Local build and test

GitHub Actions must remain disabled. Build and test locally on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:smoke
pnpm run package:win
pnpm run test:package:win
```

The package test removes system Node.js from `PATH`, exercises the friendly
opener with a full path containing spaces, validates the registration command
without changing the registry, opens a real note, calls `/api/health`, and
stops the managed server.

## Manual publishing

After local validation:

1. Confirm the ZIP hash in its `.sha256` file.
2. Update [updates/stable.json](../updates/stable.json) with the exact version,
   tag, asset URL, size and full SHA-256.
3. Commit and push directly to `main`.
4. Create the matching GitHub Release manually and attach the ZIP and checksum.
5. Download the published asset once and verify its hash.

Do not enable GitHub Actions, create a branch or open a pull request.
