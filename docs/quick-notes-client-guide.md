# Quick Notes: simple Windows guide

## What it is

IQ Wealth Quick Notes opens a normal Markdown note in a local browser page. The
note stays on your computer and can still be opened in VS Code or another
Markdown editor.

## Installing it

IQ Wealth normally handles installation and updates.

The application download is a ZIP named like:

```text
IQ-Wealth-Quick-Notes-0.1.1-win-x64.zip
```

It is not the Quick Notes Skill or instruction Markdown file. If the approved
application package is temporarily unavailable, wait for IQ Wealth to restore
it; do not install a substitute from npm.

## Adding Quick Notes to Windows

Run `Register Quick Notes.cmd` from the installed package once.

This adds **IQ Wealth Quick Notes** to Windows' **Open with** list. It does not
remove VS Code or change the current Markdown default automatically. Windows
will open its Default Apps screen, where you can choose whether Quick Notes
should become the default for `.md` files.

To remove Quick Notes from the list later, run `Remove Quick Notes.cmd`. Your
other Markdown applications are left alone.

## Opening a note

In File Explorer, right-click a `.md` file and choose:

```text
Open with > IQ Wealth Quick Notes
```

Quick Notes opens in your usual local browser. Opera and IQ Browser are both
supported by the normal browser workflow.

## Saving checklist changes

Ticking a checkbox is an edit. Wait until the page shows **Saved** before
closing it or telling IQ Wealth that the review is finished.

When you click **I'm done** or **Done Reviewing**, IQ Wealth should read the
same Markdown file again and respond to your edits, checked tasks, comments and
suggestions.

## If something does not open

Do not browse into hidden AppData folders or choose `roughdraft.cmd` manually.
Ask IQ Wealth to repair the managed Quick Notes installation or rerun the
friendly file-opener registration.
