# IQ Wealth Quick Notes agent setup

IQ Wealth Quick Notes is installed and updated by IQ Wealth. Do not run
`npm i -g roughdraft`; that command installs the unrelated public upstream
package.

The human-facing Windows opener is `Quick Notes.cmd`. Agents retain the
`roughdraft` command as a compatibility interface.

Open a note without blocking the agent:

```powershell
roughdraft open "C:\absolute\path\to\note.md" --json --no-watch
```

Confirm the returned document URL is visible. Then monitor review handoffs in
finite, recoverable intervals:

```powershell
roughdraft watch "C:\absolute\path\to\note.md" --json --timeout 60 --replay --after-sequence 0
```

If the response says `timedOut: true`, no handoff arrived during that interval.
The document remains open and editable. Repeat with the returned
`nextSequence` as `--after-sequence` so retained events are not lost or
duplicated.

The app also provides:

```text
GET /api/health
GET /api/review-events/after?projectPath=<absolute-folder>&path=<file>&afterSequence=<n>
```

The first is a purpose-built health check. The second is immediate,
nonblocking event recovery. Review events are retained in the managed local
state directory so a server restart does not erase an unconsumed handoff.

Read the complete managed workflow in:

https://github.com/N9ALV/IQ-quick-notes/blob/main/docs/iq-wealth-agent-guide.md
