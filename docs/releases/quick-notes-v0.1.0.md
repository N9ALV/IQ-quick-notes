# IQ Wealth Quick Notes 0.1.0

This is the first IQ Wealth-managed Windows package.

## Included

- Compiled Quick Notes web application and local server.
- Production-only JavaScript dependencies.
- Pinned Node.js 24.18.0 Windows x64 runtime.
- IQ-owned `bin\roughdraft.cmd` launcher.
- Machine-readable package and stable update manifests.

## Client impact

Clients do not need to install Node.js, Git, npm, pnpm or Roughdraft. IQ Wealth downloads, verifies and runs this versioned package on their behalf.

## Verification

The release was built and tested locally on Windows. GitHub Actions is disabled and was not used to produce or validate this release.

- `pnpm check`: 366 tests passed, with linting and all production builds successful.
- `pnpm test:smoke`: 11 Chromium smoke tests passed.
- `pnpm run test:package:win`: the extracted package passed with system Node.js removed from `PATH`; bundled Node.js reported `v24.18.0`, the CLI reported `0.1.0`, a real Markdown file opened, the application returned HTTP 200, and the server stopped cleanly.
- The GitHub Release ZIP was downloaded after publication and matched the stable manifest exactly.

## Published assets

- `IQ-Wealth-Quick-Notes-0.1.0-win-x64.zip` — 40,869,398 bytes.
- `IQ-Wealth-Quick-Notes-0.1.0-win-x64.zip.sha256` — detached checksum file.
- ZIP SHA-256: `e4394258e40baa4bd0ef9dedba4c52052cddb037c262065856b22f8733ad3e64`.

Source, package definition, build scripts, update metadata and installation guidance are all included in the [GitHub repository](https://github.com/N9ALV/IQ-quick-notes). The compiled runtime and its checksum are included as assets on this release.
