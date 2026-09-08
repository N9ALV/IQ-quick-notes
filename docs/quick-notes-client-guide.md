# Quick Notes: simple Windows guide

Quick Notes opens an ordinary Markdown note in your browser. Your note stays
on your computer and can still be opened in VS Code or another Markdown editor.

## Install or update

IQ Wealth normally handles this for you. Ask it to read the
[current Quick Notes instructions](https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/).
Sign in to IU normally if asked. You do not need GitHub, Node.js or npm.

The application is the **Windows ZIP download** on that page. The page's
**Download page** button downloads instructions, not the application.

After IQ Wealth has checked the download, use **Extract All**, then open
**Install Quick Notes.cmd** in the extracted folder. It installs Quick Notes
for your Windows account and adds it to the Start menu. For an update, save
and finish any open reviews first, then run the new package's installer.

The installer does not move your notes, remove VS Code or change your current
Markdown default. You can choose Quick Notes as the default later through
Windows **Default Apps**, if you wish.

## Open or create a note

- Start menu → **IQ Wealth Quick Notes** → choose your Markdown note.
- Start menu → **New Quick Note** → choose where to save a new note.
- Or right-click a Markdown file → **Open with** → **IQ Wealth Quick Notes**.

You do not need to find hidden AppData folders or select `roughdraft.cmd`.
That name is only used internally by agents. Notes in different folders can
be opened normally, including folders and filenames containing spaces.

## Edit and review

Wait for **Saved** before closing an edited note. Ticking a checklist box also
changes the file. When you finish reviewing, use the page's completion button;
IQ Wealth should then read the saved note again, including your comments.

The reading-size control makes text larger without changing the note itself.
The welcome page's **practice note** is only a trial: its warning stays visible,
and its changes are not saved to a file.

Practice accepts ordinary images and PDFs. Some other attachment formats are
blocked for safety; use a real note and ask IQ Wealth if an attachment is refused.

## If saving fails

Keep the page open. The copy and download actions can recover your **current
draft**, including edits not yet saved. A downloaded copy is a separate file;
it does not repair or overwrite the original. Ask IQ Wealth to help resolve
the save warning before continuing.

## If an update causes trouble

Ask IQ Wealth to check the installation. The previous verified managed version
can be selected with **Rollback Quick Notes.cmd**. Older installations from
before version 0.2.0 are retained, but require IQ Wealth's help for recovery.
Your notes are not deleted by rollback.

If the approved download is unavailable, wait for IQ Wealth to restore it.
Do not install a substitute Roughdraft package from npm.
