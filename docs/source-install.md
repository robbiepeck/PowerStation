# Install PowerStation on macOS from source

PowerStation's official public releases are source-only. Your Mac builds and ad-hoc signs its own
copy, so you can install the app without an Apple Developer account and without bypassing
Gatekeeper for a binary downloaded from someone else.

## Requirements

- Apple Silicon Mac (M-series) with 16 GB unified memory or more.
- [Node.js 22 or newer](https://nodejs.org/) with npm.
- Git. macOS will offer to install the Xcode Command Line Tools if Git is not already available.
- About 4 GB of free disk space for dependencies and the temporary build, in addition to model
  storage.

## Install a stable release

Open Terminal and replace `v0.18.1` with the newest stable tag shown on
[GitHub Releases](https://github.com/robbiepeck/PowerStation/releases/latest):

```bash
git clone --depth 1 --branch v0.18.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm run doctor
npm run install:mac
```

The installer uses `npm ci` to reproduce the release's locked dependencies, builds an Apple
Silicon app locally, verifies its signature, and launches it. It updates an existing writable
`/Applications/PowerStation.app`; otherwise it installs to `~/Applications/PowerStation.app`.

The install is atomic: an existing app is kept until the replacement has been copied and verified,
and is restored if installation fails. Models, chats and settings under
`~/Library/Application Support/PowerStation/` are not removed or replaced.

## Updating

From the checkout you originally installed:

```bash
npm run update:mac
```

The updater checks GitHub's latest stable release, clones that exact tag into a temporary folder,
and runs the same verified installer. It does not modify your checkout or app data. The in-app
update button opens this section when a newer source-only release is available.

## Safe diagnostics

If installation or startup fails, run:

```bash
npm run doctor
npm run diagnostics
```

The diagnostics report includes software versions, hardware capacity, install presence and data
counts/sizes. It deliberately omits usernames, paths, chat contents, document contents, model
names, configuration values and secrets. Paste that output into a GitHub issue along with the
exact command that failed.

## Why no downloadable `.dmg`?

Apple treats an app built on your Mac differently from an unnotarized app downloaded from the
internet. Publishing a consumer `.dmg` without paid Developer ID signing and Apple notarization
would add warnings and encourage unsafe workarounds. PowerStation therefore publishes source
archives only. CI still builds unsigned packages to detect packaging regressions, but those
artifacts are for project verification—not public installation.

Do not copy your locally built `.app` to another Mac. The receiving Mac may treat it as a
downloaded, unnotarized binary. Build it on that Mac using the steps above instead.

## Troubleshooting

- **Node is too old:** install Node.js 22 or newer, open a new Terminal window, then rerun
  `node --version` and `npm run doctor`.
- **A native dependency fails to install:** run `xcode-select --install`, let it finish, and retry
  `npm run install:mac`.
- **Not enough disk space:** remove the checkout's `node_modules` and `release` folders after a
  successful installation; your installed app and data are unaffected.
- **PowerStation will not close during an update:** quit it from the menu or Activity Monitor, then
  rerun `npm run update:mac`.
- **Need development mode:** follow the contributor setup in the [Setup Guide](setup.md). The
  consumer installer does not leave a development server running.
