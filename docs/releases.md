# Release channels

PowerStation has two deliberately separate distribution channels:

| Channel | Audience | Contents | In-app updater |
| --- | --- | --- | --- |
| **Nightly** | Testers and contributors | GitHub source archives for every commit merged to `main` | Never offered |
| **Stable** | End users | A manually published release with signed platform packages when available | Uses signed stable packages only |

Nightly releases are prereleases named `nightly-YYYYMMDD-<commit>`. They are source-only snapshots,
not consumer downloads. They exist so contributors can reproduce the exact state of `main`; they do
not include unsigned CI packages and do not become GitHub's Latest release.

## Using a Nightly

Choose a Nightly only when you intentionally want to test a current `main` snapshot. Download its
source archive or check out its tag, then follow the [source installation guide](source-install.md).
Nightlies are not delivered through the app's update button and are not a substitute for a stable
release.

## Publishing a signed stable release

Stable releases are deliberately manual while signing and notarisation stay with the maintainer.
Start from a tested commit already on `main`, select the new semantic version, update the changelog,
and create its `vX.Y.Z` tag. Do not publish the release until its signed package assets are ready.

For macOS:

1. Build the universal release with `npm run package:mac:signed` on a configured signing machine.
2. Notarize and staple the resulting `.app`/DMG according to your Apple Developer process.
3. Verify it with `codesign --verify --deep --strict` and `spctl --assess --type execute`.
4. Create a non-draft, non-prerelease GitHub Release for `vX.Y.Z` and attach the signed notarized
   `PowerStation-X.Y.Z-macOS-universal.dmg` or `.zip` asset.

The macOS app checks GitHub's latest stable release, validates the downloaded bundle's identity and
Gatekeeper assessment, replaces the installed application, and restarts. GitHub prereleases are
excluded, so Nightlies can never enter that path.

For Windows, attach the signed NSIS installer and its `latest.yml` metadata from the same Electron
Builder publication. For Linux, attach the AppImage and `latest-linux.yml` metadata. Those packages
become seamless in-app updates only after their corresponding platform signing or trust process is
complete.

## Maintainer checklist

- Confirm the release commit is on `main` and CI is green.
- Build, sign, and validate every platform asset you intend to publish.
- Create a standard GitHub Release, not a prerelease, with the matching `vX.Y.Z` tag.
- Attach only the signed stable packages and required update metadata.
- Test **Check for updates** from an older packaged installation before announcing the release.

If a signed stable package is not available, retain the source installer as the supported path rather
than publishing an unsigned consumer binary.
