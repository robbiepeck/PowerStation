# PowerStation

PowerStation is a desktop app for running open-source local language models on your own computer while watching the compute, memory, and power pressure they create.

The goal is to make local models easier to use safely: download a model from inside the app, chat with it locally, and keep an eye on RAM, GPU/VRAM, CPU load, power draw, thermal headroom, and tokens per second.

PowerStation is built with Electron, React, TypeScript, `node-llama-cpp`, and `systeminformation`.

## Downloads

Latest release: [v0.0.2](https://github.com/robbiepeck/PowerStation/releases/tag/v0.0.2)

| Platform | Status | Download |
| --- | --- | --- |
| macOS Apple Silicon | Available | [PowerStation-0.0.2-macOS-arm64.dmg](https://github.com/robbiepeck/PowerStation/releases/download/v0.0.2/PowerStation-0.0.2-macOS-arm64.dmg) |
| macOS Intel | Planned | Public binary pending |
| Windows x64 | Build supported, public binary pending | Use `npm run package:win` from source |

The current macOS release is ad-hoc signed but not Developer ID signed or notarized, so macOS may show a Gatekeeper warning on first launch.

## What It Does

- Downloads selected open-weight GGUF models from Hugging Face directly inside the app.
- Imports existing `.gguf` model files from your computer.
- Runs chats locally through `node-llama-cpp`.
- Shows live device telemetry while the model is running.
- Tracks CPU, RAM, GPU/VRAM where available, estimated power draw, thermal headroom, and generation speed.
- Provides runtime guardrail controls for memory budget, compute cap, context window, idle unload, and low-power bias.
- Checks GitHub Releases for desktop app updates.

PowerStation does not have a browser/web version. Local model execution and host telemetry require the desktop app.

## How To Use

1. Download and install the desktop app for your platform.
2. Open PowerStation.
3. On first launch, choose a starter model from the model catalog.
4. Click `Download`. PowerStation downloads the model into its local model folder and selects it when the download finishes.
5. Start chatting from the Chat view.
6. Open Monitor to watch local resource usage while the model runs.
7. Open Models to import a local `.gguf` file, add a model folder, or download another model.
8. Open Settings to adjust runtime limits and generation behavior.

Larger models need more RAM and will usually run slower on CPU-only machines. Start with a smaller model if you are testing PowerStation on a laptop or a machine with limited memory.

## Starter Models

The app currently presents these starter options:

| Model | Best for | Approx. download | Suggested memory | License shown in app |
| --- | --- | ---: | ---: | --- |
| Qwen3 0.6B | Fast first run and weak laptops | 639 MB | 4 GB RAM | Apache-2.0 |
| Qwen3 4B | Everyday chat and summarising | 2.50 GB | 8 GB RAM | Apache-2.0 |
| Qwen3 8B | Better reasoning and higher quality answers | 5.03 GB | 12 GB RAM | Apache-2.0 |
| Qwen2.5 Coder 3B | Code snippets, review, and refactors | 2.10 GB | 8 GB RAM | Qwen research |

Models are downloaded from Hugging Face as GGUF files and run on-device.

## Updates

PowerStation checks this repository's GitHub Releases for updates. When a newer release is available, an Update button appears in the sidebar. Clicking it downloads the latest desktop package and restarts into the update when ready.

For update releases, Electron Builder assets must be attached to the GitHub Release, including:

- `latest-mac.yml` for macOS
- `latest.yml` for Windows
- the packaged app archives/installers referenced by those metadata files

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run desktop:dev
```

Run checks:

```bash
npm run build
npm run lint
```

## Packaging

Build the macOS Apple Silicon package:

```bash
npm run build && npx electron-builder --mac --arm64
```

Build an unpacked macOS Apple Silicon app directory:

```bash
npm run build && npx electron-builder --mac --arm64 --dir
```

Build Windows x64 packages:

```bash
npm run package:win
```

Build an unpacked Windows directory:

```bash
npm run package:win:dir
```

Artifacts are written to `release/`.

Production macOS distribution should use Apple Developer ID signing and notarization. Ad-hoc signed local builds may trigger Gatekeeper warnings.

## Architecture

- `electron/preload.cjs` exposes the controlled desktop bridge to the renderer.
- `electron/llm.ts` owns GGUF model loading, local chat, and model downloading through `node-llama-cpp`.
- `electron/models.ts` indexes imported and managed model files.
- `electron/telemetry.ts` samples host telemetry through `systeminformation` and `node-llama-cpp` where available.
- `electron/updates.ts` handles GitHub Release update checks and installs through `electron-updater`.
- `src/modelCatalog.ts` defines the starter model catalog shown on first run and in the Models view.

Runtime limits are represented in the UI today. Some limits are advisory because llama.cpp manages low-level allocation directly.
