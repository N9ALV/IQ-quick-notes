# Security and operating boundaries

Quick Notes is a local, single-Markdown-file companion. It is not a sandbox for
running arbitrary active documents, an Internet-facing file service, a cloud
backup or a replacement for operating-system access controls.

## Maintained distribution

Use the approved IQ Wealth package and current instructions from the
[canonical IU page](https://iu.com.au/iq/app/docs/kb/resources/iq-wealth-quick-notes/).
Verify the complete ZIP hash and size before execution. Per-file inventory
checks detect alteration and incomplete extraction; they are not signatures.
The application and agent Skill are distinct downloads.

## Local server

- Host names, browser Origin and the actual network peer are checked before
  API bodies are processed. Deceptive loopback-like hostnames are not local.
- Ordinary local CLI requests and same-origin local browser requests remain
  supported. Non-loopback access requires the existing configured token.
- Forwarded headers do not confer trust. Do not expose the listener through an
  arbitrary reverse proxy or open an Internet firewall port as client setup.
- Existing remote-document handoff is optional and must retain its token and
  restricted session behaviour. Do not substitute IU credentials or introduce
  special Vault access for it.
- Local attachment responses are sandboxed so HTML/SVG scripts cannot act as
  the app. Normal image and PDF rendering is retained.
- Practice attachments are limited to ordinary raster images and PDF. Active
  formats such as SVG/HTML are rejected visibly; use a real-file note for a
  sandboxed supported attachment rather than executing a practice Blob URL.

The local user account remains trusted. A process already running with that
account's file access is outside these browser/network protections. Notes and
review-event state remain on disk; protect them with appropriate Windows
permissions, backups and the client's approved storage practices.

Do not place passwords, recovery codes, private keys or unnecessary sensitive
identifiers in casual notes. Avoid sharing URLs containing remote-session
tokens, and never commit such tokens or client notes to this repository.

## Reporting

For a suspected issue, contact the IQ Wealth maintainer through the established
support channel. Provide the installed version, a minimal synthetic example
and relevant error text. Do not post client files, credentials or live token
URLs in a public GitHub issue.

Releases are tested and published manually. GitHub Actions is not required.
