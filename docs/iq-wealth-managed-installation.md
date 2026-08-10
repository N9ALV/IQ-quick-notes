# IQ Wealth managed installation and updates

## Client experience

Clients do not install or update Quick Notes themselves. They do not need Git, GitHub, Node.js, npm, pnpm or access to this source repository.

When Quick Notes is first required, IQ Wealth should download an approved Windows release, verify it, extract it into the user's local IQ Wealth application directory and invoke its bundled launcher. Later updates follow the same version-pinned process.

Do not run `npm i -g roughdraft`. That command installs the public upstream package, not the IQ Wealth build.

## Release package

The Windows package is named:

```text
IQ-Wealth-Quick-Notes-<version>-win-x64.zip
```

It contains:

```text
IQ-Wealth-Quick-Notes-<version>-win-x64/
  app/                    Compiled application and production dependencies
  bin/roughdraft.cmd      IQ-owned compatibility launcher
  runtime/node.exe        Pinned Node.js runtime
  runtime/NODE-LICENSE.txt
  manifest.json           Machine-readable package identity
  README.txt
```

The command remains `roughdraft.cmd` so existing IQ Wealth skills and agent workflows continue to work. The launcher always calls the runtime inside the same package and never relies on a globally installed `roughdraft` or `node` command.

## Building locally

GitHub Actions is intentionally disabled for this repository. Approved packages are built and tested locally on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test:smoke
pnpm run package:win
pnpm run test:package:win
```

`pnpm run package:win` performs the production build, creates a hoisted production-only dependency tree, downloads the pinned official Node.js Windows runtime, verifies it against Node.js's published SHA-256 list, and writes the ZIP plus its checksum to `artifacts\`.

`pnpm run test:package:win` extracts the finished ZIP into a temporary directory and validates the actual release boundary. It removes system Node.js from `PATH`, runs the bundled launcher, opens a real Markdown file, checks that the local app returns HTTP 200, and stops the managed server.

The package definition is [packaging/windows-package.json](../packaging/windows-package.json). Change its version, Node.js version and release tag deliberately for each approved release.

## Publishing manually

After local validation:

1. Compute or confirm the ZIP SHA-256 recorded in its `.sha256` file.
2. Update [updates/stable.json](../updates/stable.json) with the exact version, tag, asset URL, size and SHA-256.
3. Commit and push the source and stable update manifest.
4. Create the matching GitHub Release manually and attach both the ZIP and `.sha256` file.
5. Download the published asset once and confirm its hash matches the stable manifest.

Do not enable GitHub Actions as part of this process.

## IQ Wealth installation layout

Recommended per-user layout:

```text
%LOCALAPPDATA%\IQ Wealth\Quick Notes\
  versions\
    0.1.0\
      app\
      bin\roughdraft.cmd
      runtime\node.exe
      manifest.json
  current.json
```

IQ Wealth may invoke the versioned launcher directly:

```text
%LOCALAPPDATA%\IQ Wealth\Quick Notes\versions\0.1.0\bin\roughdraft.cmd open "C:\path\to\note.md" --json
```

If IQ Wealth exposes a stable launcher under `%LOCALAPPDATA%\IQ Wealth\bin\roughdraft.cmd`, that launcher must resolve the version recorded in `current.json`; it must not invoke a global npm command.

## Safe install and update procedure

IQ Wealth should implement the following sequence:

1. Fetch `updates/stable.json` over HTTPS.
2. Compare its version with the version in the installed `manifest.json`.
3. Download the exact asset named in the update manifest.
4. Verify the downloaded byte count and SHA-256 before extraction.
5. Extract to a new version directory, never over the currently running version.
6. Validate the extracted `manifest.json`, bundled `runtime\node.exe` and `bin\roughdraft.cmd`.
7. Run `roughdraft.cmd --version` and a local health check.
8. Atomically replace `current.json` only after validation passes.
9. Keep the previous approved version for rollback.

If any verification fails, IQ Wealth should leave the current version unchanged and report a clear maintenance error. Clients should never be directed to npm or GitHub as a fallback.

## Stable update manifest

`updates/stable.json` is the machine-readable source of truth for the currently approved package. IQ Wealth should treat these fields as mandatory:

- `version`
- `releaseTag`
- `assetName`
- `downloadUrl`
- `sha256`
- `size`
- `nodeVersion`
- `platform`
- `architecture`

Only the `win32` and `x64` values are supported by the first package. Additional architectures should use separate, explicitly named assets and checksums.
