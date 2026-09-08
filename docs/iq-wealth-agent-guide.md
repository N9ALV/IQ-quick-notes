# IQ Wealth Quick Notes agent guide

## Use the managed installation

First obtain the current instructions and separately labelled Windows package
from the [permanent IU Quick Notes page](https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/).
Use ordinary IU member sign-in. Clients and their agents do not need GitHub.
The page's **Download page** action retrieves the Skill, not the application.

IQ Wealth installs and updates Quick Notes for the client. Never install or
update it with npm, pnpm, Git or a public Roughdraft installer.

The package deliberately has two launchers:

- `Quick Notes.cmd` is the friendly Windows file opener for people.
- `roughdraft.cmd` is the compatibility command for IQ Wealth agents and
  existing automations.

If the managed command is unavailable, report that Quick Notes needs IQ Wealth
maintenance. Do not substitute the public `roughdraft` npm package.

Version 0.2.0 supplies an actual installer: after checking the approved ZIP's
size and complete hash, extract it outside the installation and run
`Install Quick Notes.cmd`. Do not construct `current.json` by hand. See the
[managed installation guide](iq-wealth-managed-installation.md) for precise
installation, update, legacy recovery and test commands.

Use the stable installed launcher, normally
`%LOCALAPPDATA%\IQ Wealth\Quick Notes\bin\roughdraft.cmd`. Resolve its full
path explicitly; the bare commands below are shorthand, not permission to use
whatever public `roughdraft` happens to be on PATH.

## Reliable open and handoff pattern

Open the Markdown file and return immediately:

```powershell
roughdraft open "C:\absolute\path\to\note.md" --json --no-watch
```

Check the JSON result has `opened: true`, then make sure the returned URL is
visible in the client's browser. A local browser page is expected; no note is
uploaded by this workflow.

The returned URL and the Markdown file on disk identify the active note. Do
not infer the current note folder from `/api/status.projectDir`: that field is
the folder used when the reusable stateless server first started. Opening a
note from another folder is supported and does not require stopping the
managed server.

Monitor in a separate or background process with a finite timeout:

```powershell
roughdraft watch "C:\absolute\path\to\note.md" --json --timeout 60 --replay --after-sequence 0
```

Interpret the result exactly:

- `timedOut: false` means one or more review handoffs were received. Read the
  Markdown file again before responding.
- `timedOut: true` means no handoff arrived in that interval. It does not mean
  the app, document or browser failed.
- Use the returned `nextSequence` as the next `--after-sequence` value. Review
  events are retained in the managed state directory and survive a normal
  Quick Notes server restart.

For an immediate, nonblocking check, use a zero-second timeout:

```powershell
roughdraft watch "C:\absolute\path\to\note.md" --json --timeout 0 --replay --after-sequence 0
```

The server equivalents are:

```text
GET /api/health
GET /api/review-events/after?projectPath=<absolute-folder>&path=<file>&afterSequence=<n>
```

Do not infer success from the homepage alone. `/api/health` reports the server
process, port, uptime, active watcher count and latest review-event sequence.

## Notes and checklists

Quick Notes opens one local Markdown file at a time. In rich-text editing mode,
clicking a checklist box is an edit and autosaves the corresponding Markdown
from `- [ ]` to `- [x]`. Wait for the visible `Saved` state before closing the
page or handing the note back.

After a handoff, always read the Markdown file from disk. That file, including
checked tasks, text edits, comments and suggestions, is the source of truth.

The welcome page's practice note is temporary and must not be used as proof of
disk saving or a completed client handoff. Reading-size preferences change
display only. Copy/download now recover the current draft, including unsaved
edits; a downloaded copy does not mean the original note was saved or repaired.

## Download identity

The Quick Notes application package and the Quick Notes agent Skill are
different downloads:

- Application: `IQ-Wealth-Quick-Notes-<version>-win-x64.zip`
- Agent instructions: the `iq-wealth-quick-notes` Skill Markdown

Never present the Skill file as the Windows application. IQ Wealth's protected
download should deliver the approved ZIP and its checksum together. If that
package is temporarily unavailable, say so clearly and stop; do not redirect a
client to npm or an unapproved substitute.
