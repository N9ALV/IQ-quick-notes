## IQ Wealth Quick Notes

Use IQ Wealth's managed Quick Notes installation for short local Markdown
notes, checklists and review handoffs. Do not install or update Roughdraft from
npm, Git or another public source.

Open one Markdown file at a time and return control immediately:

```powershell
roughdraft open "C:\absolute\path\to\note.md" --json --no-watch
```

Monitor the review separately with a finite, replayable request:

```powershell
roughdraft watch "C:\absolute\path\to\note.md" --json --timeout 60 --replay --after-sequence 0
```

On every result, carry the returned `nextSequence` into the next watch. Treat
`timedOut: true` only as “no handoff during this interval”. Do not claim that
the review completed unless an event was returned.

After a review event, read the Markdown file from disk again. Checked tasks,
text edits, comments, suggestions and document-level comments are persisted in
that file and are the source of truth.

The application ZIP and the IQ Wealth Quick Notes Skill are different
resources. Never supply the Skill Markdown when a person needs the Windows
application package.

Full guidance:

https://github.com/N9ALV/IQ-quick-notes/blob/main/docs/iq-wealth-agent-guide.md
