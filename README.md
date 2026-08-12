# IQ Wealth Quick Notes

IQ Wealth Quick Notes is a simple, local Markdown editor and review surface for
IQ Wealth clients. It opens one `.md` file in a local browser, saves edits back
to that file, supports checklists and CriticMarkup review comments, and hands a
completed review back to an IQ Wealth agent.

It is an IQ Wealth adaptation of
[Lex Inc's Roughdraft](https://github.com/Lex-Inc/roughdraft), not a Hubble
clone or rework. The internal `roughdraft` command remains only for backwards
compatibility with existing agent workflows.

## Approved Windows package

Current release: [IQ Wealth Quick Notes 0.1.1](https://github.com/N9ALV/IQ-quick-notes/releases/tag/quick-notes-v0.1.1)

The Windows application and the agent Skill are separate downloads:

- Application: `IQ-Wealth-Quick-Notes-0.1.1-win-x64.zip`
- Agent instructions: `iq-wealth-quick-notes` Skill Markdown

Do not use the Skill file as the application package. Do not install
`roughdraft` from npm. IQ Wealth Quick Notes is supplied as a self-contained,
version-pinned Windows package with its own Node.js runtime.

Machine-readable release details, full SHA-256 and byte count are in
[`updates/stable.json`](updates/stable.json).

## Client experience

IQ Wealth normally installs and updates Quick Notes. Clients do not need Git,
GitHub, Node.js, npm or pnpm.

The package includes:

- `Quick Notes.cmd` — friendly file opener for people and Windows;
- `Register Quick Notes.cmd` — adds Quick Notes to **Open with** without
  changing the current Markdown default or removing VS Code;
- `roughdraft.cmd` — managed compatibility command for agents;
- the compiled app, local server and pinned runtime.

The application opens in a local browser page. The Markdown file remains on
the client's computer.

See:

- [Simple client guide](docs/quick-notes-client-guide.md)
- [Managed installation and updates](docs/iq-wealth-managed-installation.md)
- [Agent guide](docs/iq-wealth-agent-guide.md)

## Agent workflow

Open a note and return immediately:

```powershell
roughdraft open "C:\complete\path\to\note.md" --json --no-watch
```

Monitor handoffs in finite, replayable intervals:

```powershell
roughdraft watch "C:\complete\path\to\note.md" --json --timeout 60 --replay --after-sequence 0
```

Use the returned `nextSequence` for the next watch. After a handoff, re-read the
Markdown file from disk; it is the durable source of truth.

Operational endpoints:

```text
GET /api/health
GET /api/review-events/after?projectPath=<absolute-folder>&path=<file>&afterSequence=<n>
```

## Local development

This is a pnpm workspace containing the web app, local server and
Roughdraft-flavoured Markdown parser.

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:smoke
```

Build and test the self-contained Windows package:

```powershell
pnpm run package:win
pnpm run test:package:win
```

The package test exercises the actual ZIP with system Node.js removed from
`PATH`, a full Markdown path containing spaces, the friendly Windows opener,
the file-association command, `/api/health`, and a clean server stop.

## Releases

GitHub Actions is intentionally disabled. Releases are built and tested
locally on Windows, committed and pushed directly to `main`, then published
manually with the ZIP and detached `.sha256` file.

Release procedure and rollback rules are in
[the managed installation guide](docs/iq-wealth-managed-installation.md).

## Licence and upstream attribution

The source retains the upstream MIT licence and Roughdraft package lineage.
IQ Wealth packaging, branding, managed-install guidance and Windows integration
are maintained in this repository.
