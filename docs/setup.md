# Setup Guide

Prerequisites, building, packaging, where data lives, and troubleshooting. For the fastest path to a
running app, see the [Quick Start](quick-start.md).

## Prerequisites

- **macOS on Apple Silicon** (M-series), 16 GB unified memory or more.
- **Node.js 20+** and **npm**.
- **Xcode Command Line Tools** — `xcode-select --install`. The `node-llama-cpp` runtime ships as a
  prebuilt binary, so a source compile is usually unnecessary, but the CLT are required if it ever
  falls back to building from source.

## Install and run

```bash
git clone https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm install
npm run desktop:dev
```

`npm run desktop:dev` runs Vite and Electron together (via `concurrently`). It builds the Electron
main process, waits for the dev server, then launches the app pointed at it.

### Running on a custom port

`desktop:dev` uses Vite's default port (5173). If another project is already holding that port, Vite
will auto-bump the renderer to a different port while Electron still points at 5173 — which loads the
wrong page. To avoid this, run the two halves yourself on a free port:

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

## Building a distributable

```bash
npm run package:mac        # universal macOS build
npm run package:mac:dir    # unpacked .app directory (faster, for local testing)
```

Artifacts land in `release/`.

**Signing & notarization.** The current macOS build is ad-hoc signed, not Developer ID signed or
notarized, so macOS Gatekeeper will warn on first open (right-click → Open, or allow it in
*System Settings → Privacy & Security*). Notarization is on the [Roadmap](../ROADMAP.md) and is a
prerequisite before any consumer release.

**Native module packaging.** `node-llama-cpp` ships native binaries that must be unpacked from the
asar archive at build time — this is already configured under `build.asarUnpack` in `package.json`.
The model catalogue (`catalog/**`) is also included in the packaged app as the offline fallback.

## Where data lives

Everything PowerStation writes stays on your machine, under the app's user-data directory
(`~/Library/Application Support/PowerStation/`):

- **Models** — the managed models folder (each model is revealable in Finder from the Models view).
- **`powerstation-config.json`** — settings, tool permissions, onboarding state.
- **`catalog-cache.json`** — the last validated catalogue fetched from the repo.
- **Chats** — held in memory only; nothing is persisted unless you copy it out.

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
