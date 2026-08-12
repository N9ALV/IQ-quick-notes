# IQ Wealth Quick Notes 0.1.1

This maintenance release addresses the first client acceptance reports for the
managed Windows package.

## Client improvements

- Adds `Quick Notes.cmd`, a friendly file opener that preserves a Markdown
  file's complete Windows path, including folders and spaces.
- Adds safe per-user **Open with** registration under the name **IQ Wealth
  Quick Notes**.
- Leaves VS Code and the current `.md` default unchanged; Windows shows the
  supported Default Apps screen for the user's choice.
- Removes the extra top-level folder from the ZIP.
- Separates the application-package instructions from the Quick Notes agent
  Skill so one is not mistaken for the other.

## Reliability improvements

- Adds `GET /api/health` with process, port, uptime and review-event status.
- Sends review-watch response headers before waiting for the event body,
  preventing long waits from failing at the HTTP header boundary.
- Retains recent review events in the managed local state directory and adds
  immediate sequence-based recovery.
- Extends the Windows server start allowance for slower client machines.
- Removes npm installation and update advice from managed-package help.

## Acceptance coverage

- Real package test with a Markdown path containing spaces and a different
  working directory.
- File-association command validation without changing the test machine's
  registry.
- Real browser reload test proving the same document remains open.
- Real browser checkbox test proving `- [ ]` changes to `- [x]` on disk.
- Purpose-built health and review-event transport tests.

The final ZIP byte count and SHA-256 are recorded in
[`updates/stable.json`](../../updates/stable.json). GitHub Actions remained
disabled; all validation was run locally on Windows.

## Verification results

- `pnpm check`: 372 unit/integration tests passed, with linting and production
  builds successful.
- `pnpm test:smoke`: 11 Chromium smoke tests passed.
- Focused reload and checklist persistence: 2 Chromium tests passed.
- `pnpm run test:package:win`: passed with no system Node.js, HTTP 200,
  `/api/health` reporting `ok`, the friendly opener preserving the full path,
  and no Markdown-default change.

Published asset:

- `IQ-Wealth-Quick-Notes-0.1.1-win-x64.zip` — 40,805,799 bytes
- SHA-256:
  `0604512fe9b807f0a36fbe3fbec2405f7d26fa0d189143837af418c820f113e6`
