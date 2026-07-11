# Setup Guide

Prerequisites, building, packaging, where data lives, and troubleshooting. For the fastest path to a
running app, see the [Quick Start](quick-start.md).

## Prerequisites

**macOS (primary platform)**

- macOS on Apple Silicon (M-series), 16 GB unified memory or more.
- **Node.js 20+** and **npm**.
- **Xcode Command Line Tools** — `xcode-select --install`. The `node-llama-cpp` runtime ships as a
  prebuilt binary, so a source compile is usually unnecessary, but the CLT are required if it ever
  falls back to building from source.

**Windows (beta)**

- Windows 10/11 x64, 16 GB RAM or more. A discrete GPU (NVIDIA/AMD, 8 GB+ VRAM) is strongly
  recommended — models run on CUDA/Vulkan when available and fall back to CPU otherwise.
- Multi-GPU laptops and desktops are supported: PowerStation lists detected adapters and uses the
  largest discrete NVIDIA/AMD VRAM budget until the runtime reports its exact backend memory.
- **Node.js 20+** and **npm**. Prebuilt `node-llama-cpp` binaries (CPU, CUDA and Vulkan variants)
  install automatically; Visual Studio Build Tools are only needed if a source build is ever forced.
- Keep your GPU drivers current — the CUDA/Vulkan runtimes use them directly.

**Linux (beta)**

- Linux x64 on a desktop distribution with 16 GB RAM or more. Ubuntu/Debian derivatives are the
  tested packaging target; the AppImage should also run on many other mainstream desktop distros.
- **Node.js 20+** and **npm**. Prebuilt `node-llama-cpp` Linux binaries install automatically; a
  system compiler toolchain is only needed if a source build is ever forced.
- Keep NVIDIA/AMD GPU drivers current when using GPU acceleration. Without a supported discrete
  GPU, inference runs on CPU from system RAM.

## Install and run

```bash
git clone https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm install
npm run desktop:dev
```

`npm run desktop:dev` selects a free loopback port, starts Vite, builds the Electron main process,
then launches the app pointed at that exact port. It will not attach to an unrelated dev server.

### Running on a custom port

`desktop:dev` handles occupied ports automatically. To run the two halves yourself on a specific
port, use:

```bash
# terminal 1 — dev server on a dedicated port
npx vite --host 127.0.0.1 --port 5180

# terminal 2 — build electron, then launch it against that port
npm run build:electron
VITE_DEV_SERVER_URL=http://127.0.0.1:5180 npx electron .
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run desktop:dev` | Run the app in development (Vite + Electron). |
| `npm run build` | Typecheck and build the renderer and the Electron main process. |
| `npm run build:renderer` | Renderer only (`tsc -b` + `vite build`). |
| `npm run build:electron` | Electron main only (`tsc` + copy preload). |
| `npm test` | Run the unit tests (admission-control math, via Vitest). |
| `npm run lint` | ESLint. |
| `npm run package:mac` | Package the macOS app with electron-builder. |
| `npm run package:win` | Package the Windows NSIS installer and portable exe on Windows. |
| `npm run package:win:signed` | Package Windows artifacts and fail if code signing credentials are missing. |
| `npm run package:linux` | Package the Linux x64 AppImage and deb on Linux. |

## Building a distributable

```bash
npm run package:mac        # universal macOS build
npm run package:mac:dir    # unpacked .app directory (faster, for local testing)
npm run package:win        # Windows NSIS installer + portable exe (run on Windows)
npm run package:win:signed # Windows release build, requires signing credentials
npm run package:linux      # Linux AppImage + deb (run on Linux)
npm run package:linux:dir  # unpacked Linux app directory
```

Artifacts land in `release/`.

**Build on the target platform.** The native llama.cpp binaries are platform-specific, so a working
Windows build must be produced on Windows, macOS on macOS, and Linux on Linux. That's exactly what
CI does: the [GitHub Actions workflow](../.github/workflows/ci.yml) lint/tests/builds on all three
platforms for every push to `main`, uploads a Windows installer, macOS app, and Linux AppImage/deb
as build artifacts, and publishes all of them to the GitHub Release when a `v*` tag is pushed. To
grab the latest Linux package without a release: repo → **Actions** → newest CI run → **Artifacts**
→ `PowerStation-linux-x64`.

**Signing & notarization.** Local `package:mac` builds are ad-hoc signed for contributor testing, so
Gatekeeper can warn on first open (right-click → Open, or allow it in *System Settings → Privacy &
Security*). Tagged macOS CI releases require Developer ID signing, hardened runtime and Apple
notarization; the release job fails before publishing if any credential is missing. Configure these
GitHub Actions secrets before tagging a public release: `MACOS_CSC_LINK` (base64 `.p12`),
`MACOS_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64` (base64 App Store Connect `.p8`),
`APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. Release tags must point to a commit already on `main`.

Tagged Windows CI releases also run with `forceCodeSigning=true`. Configure `WINDOWS_CSC_LINK` and
`WINDOWS_CSC_KEY_PASSWORD` with a Windows code-signing certificate before tagging a public Windows
release. Non-tag Windows CI artifacts remain unsigned for testing; use `npm run package:win:signed`
locally when you want the same fail-if-unsigned behavior.

**Linux updates.** The AppImage build includes Electron Builder update metadata and can use
PowerStation's in-app updater when it is launched from the AppImage. The deb package follows normal
package replacement: download and install the newer `.deb` from Releases.

**Native module packaging.** `node-llama-cpp` ships native binaries that must be unpacked from the
asar archive at build time — this is already configured under `build.asarUnpack` in `package.json`.
The model catalogue (`catalog/**`) is also included in the packaged app as the offline fallback.

## Where data lives

Everything PowerStation writes stays on your machine, under the app's user-data directory
(`~/Library/Application Support/PowerStation/` on macOS, `%APPDATA%\PowerStation\` on Windows, and
`~/.config/PowerStation/` on Linux):

- **Models** — the managed models folder (each model is revealable in the OS file manager from the Models view).
- **`powerstation-config.json`** — settings, tool permissions, onboarding state, benchmark results.
- **`catalog-cache.json`** — the last validated catalogue fetched from the repo.
- **`chats/`** — saved conversations, one plain JSON file each (including any attached-file text,
  so resumed chats keep their documents). Revealable and deletable from Settings; turn off "Save
  chats on this device" to stop new writes.
- **`rag/`** — one JSON index per knowledge folder you attach (chunks + embedding vectors).
- **`embeddings/`** — the small embedding model (~84 MB, downloaded once) that powers
  chat-with-a-folder. Fully offline after the first download.
- **`skills/`** — one markdown file per skill (starters, gallery installs, and your own).
- **`projects/`** — one JSON file per workspace (instructions, knowledge folder, skill modes,
  connector selection, preferred model).
- **`repair-log.json`** — everything the Repair tab or repair skill has ever removed.
- **Backups** — single JSON archives written wherever you choose from Settings → Backup & restore.

Network traffic is limited to model downloads and catalogue updates from `huggingface.co` / this
GitHub repo, plus update checks against GitHub Releases. See [Security](../SECURITY.md).

## Updating the model catalogue

The catalogue is data, not code. To refresh it in a running app, use **Update catalog** in the
Models view — it re-fetches `catalog/models.json` from the repo. To change what's offered, edit that
file (see [Contributing](../CONTRIBUTING.md) for the required fields) and the change reaches users
without an app release.

## Troubleshooting

- **Wrong app appears in the window** — a stale dev server on port 5173 from another project. Use the
  custom-port instructions above.
- **`node-llama-cpp` fails to load / native error** — ensure the Command Line Tools are installed;
  delete `node_modules` and re-run `npm install` to re-fetch the prebuilt binary.
- **A model crashes the runtime** — you'll get a recovery card, not a dead app. Try a smaller
  context or a smaller model; the app applies a short cooldown before re-spawning the runtime.
- **Gatekeeper blocks a packaged build** — see *Signing & notarization* above.

Next: [Architecture](architecture.md) · [Contributing](../CONTRIBUTING.md)
