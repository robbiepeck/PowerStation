# Install PowerStation on macOS from source

Nightly releases contain source code only. This supported installer builds and ad-hoc signs
PowerStation on the destination Mac, avoiding the need to bypass Gatekeeper for an unsigned binary
downloaded from the internet. Signed stable releases can instead provide consumer packages and
seamless in-app updates; see [Release channels](releases.md).

## Requirements

- Apple Silicon Mac with at least 16 GB unified memory;
- Node.js 22 or newer with npm;
- Git and the Xcode Command Line Tools;
- approximately 4 GB of temporary free storage for dependencies and build output, in addition to
  model storage.

Run `xcode-select --install` if the Command Line Tools are not already available.

## Install a stable release

Replace `v0.19.1` with the newest stable tag shown on
[GitHub Releases](https://github.com/robbiepeck/PowerStation/releases/latest):

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm run doctor
npm run install:mac
```

The installer uses `npm ci` to reproduce the release's locked dependencies, creates an Apple
Silicon package, verifies its local signature, and opens the installed application. It updates a
writable `/Applications/PowerStation.app` when present; otherwise it uses
`~/Applications/PowerStation.app`.

Installation is atomic. The existing application remains in place until the replacement has been
copied and verified, and it is restored if the operation fails. User data under
`~/Library/Application Support/PowerStation/` is not removed or replaced.

## Update an existing installation

From the checkout originally used for installation:

```bash
npm run update:mac
```

The updater resolves the latest stable GitHub release, clones that exact tag into a temporary
directory, and runs the same verified installer. It does not modify the current checkout or the
PowerStation user-data directory. A signed stable packaged app downloads and installs its matching
update in-app; a source-built app uses this documented source-update path instead.

## Collect privacy-safe diagnostics

If installation or startup fails, run:

```bash
npm run doctor
npm run diagnostics
```

The diagnostics report includes software versions, hardware capacity, installation state, and data
counts and sizes. It excludes usernames, user paths, chats, documents, model names, schedule content,
configuration values, and secrets.

When opening an issue, include the diagnostic output, the exact command that failed, the PowerStation
version, and the macOS version.

## Why the source installer remains supported

An application built locally is handled differently by macOS from an unnotarized application
downloaded from the internet. A consumer DMG is published only after Developer ID signing and Apple
notarization; otherwise the source installer remains the supported route. This avoids security
warnings and unsafe workarounds.

CI still builds unsigned packages to detect packaging regressions. Those artifacts are temporary
verification outputs and are not supported installations. Do not copy a locally built `.app` to
another Mac; build it on the destination Mac using the documented workflow.

## Remove temporary build files

After a successful installation, the checkout's `node_modules/` and `release/` directories may be
removed to recover disk space. This does not affect the installed application or its user data.

## Troubleshooting

- **Node.js is too old:** install Node.js 22 or newer, open a new terminal, confirm `node --version`,
  and rerun `npm run doctor`.
- **A native dependency fails to install:** run `xcode-select --install`, allow installation to
  finish, then retry `npm run install:mac`.
- **The application cannot close during an update:** quit PowerStation from the application menu or
  Activity Monitor, then rerun `npm run update:mac`.
- **Development mode is required:** use the contributor workflow in [Setup](setup.md). The stable
  source installer does not leave a Vite development server running.

Return to the [quick start](quick-start.md) or continue with [Setup](setup.md).
