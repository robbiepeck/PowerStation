# PowerStation

PowerStation is a desktop app for downloading, running, and monitoring open-source local language models on your own computer.

The aim of the project is to make local AI easier to use without hiding what it costs your machine. PowerStation gives users a friendly interface for choosing a model, starting a local chat session, and watching how much CPU, RAM, GPU/VRAM, power, heat, and generation speed the model is using.

PowerStation is intended for people who want the privacy and control of local models, but still want guardrails around memory pressure, compute load, and laptop performance.

## Current Status

PowerStation is early desktop software. The macOS Apple Silicon build is available now. Windows builds are supported from source, and public Windows release binaries are planned.

PowerStation does not have a web version. Browser apps cannot reliably inspect host-level model memory usage, GPU/VRAM pressure, power draw, or local runtime state, so PowerStation is desktop-only.

A "computer repair" feature that helps diagnose (and pontentially fix) problems with memory, ram, and other performance issues with computer devices is planned, with extremely careful use of agentic tools when editing essential computer files.

PowerStation aims to eventually provide a powerful model harness (skills, connectors) and fine tuning abilities. 

## Download

Latest release: [v0.0.8](https://github.com/robbiepeck/PowerStation/releases/tag/v0.0.8)

| Platform | Status | Download |
| --- | --- | --- |
| macOS Apple Silicon | Available | [PowerStation-0.0.8-macOS-arm64.dmg](https://github.com/robbiepeck/PowerStation/releases/download/v0.0.8/PowerStation-0.0.8-macOS-arm64.dmg) |
| macOS Intel | Planned | Public binary pending |
| Windows x64 | Build supported, public binary pending | Build from source with `npm run package:win` |

The current macOS release is ad-hoc signed, but not yet Developer ID signed or notarized. macOS may show a Gatekeeper warning the first time you open it.

## What PowerStation Does

- Downloads selected GGUF models from Hugging Face inside the app.
- Imports existing `.gguf` model files from your computer.
- Runs local chats through `node-llama-cpp`.
- Shows live device telemetry while models run.
- Tracks CPU, RAM, GPU/VRAM where available, storage used/free, estimated power draw, thermal headroom, and tokens per second.
- Opens a storage breakdown view for large files, stale downloads, caches, Trash, and local model storage.
- Shows estimated device age, reported battery capacity, and rough performance capacity where available.
- Provides runtime controls for memory budget, compute cap, context window, idle unload, and low-power bias.
- Uses GitHub Releases for app distribution.

## How To Use

1. Download the app for your platform.
2. Install and open PowerStation.
3. On first launch, choose a starter model from the model catalog.
4. Click `Download`. PowerStation downloads the model into its managed local model folder.
5. When the download finishes, PowerStation imports and selects the model automatically.
6. Open the Chat or Workbench view and start a local conversation.
7. Open Monitor to watch resource usage while the model is running.
8. Open Models to download another starter model, import a `.gguf` file, or add a model folder.
9. Open Settings to adjust runtime limits and generation behavior.

Start with a smaller model if you are testing on a laptop or a machine with limited RAM. Larger models usually produce better answers, but they also use more memory and run more slowly on CPU-only machines.

## Starter Models

PowerStation includes a starter catalog of downloadable local models. These are chosen to cover small, balanced, coding, reasoning, and heavier general-purpose use cases.

| Model | Family | Best for | Approx. download | Suggested memory | License shown in app |
| --- | --- | --- | ---: | ---: | --- |
| Qwen3 0.6B | Qwen | Fast first run and weak laptops | 639 MB | 4 GB RAM | Apache-2.0 |
| Gemma 3 1B IT | Gemma | Lightweight Google-tuned chat and summaries | 1.00 GB | 4 GB RAM | Gemma |
| Llama 3.2 3B Instruct | Llama | General chat with a familiar assistant style | 2.02 GB | 8 GB RAM | Llama 3.2 |
| Qwen3 4B | Qwen | Everyday chat and summarising | 2.50 GB | 8 GB RAM | Apache-2.0 |
| Gemma 3 4B IT | Gemma | Instruction following and everyday writing | 3.16 GB | 8 GB RAM | Gemma |
| Qwen3 8B | Qwen | Better reasoning and higher quality answers | 5.03 GB | 12 GB RAM | Apache-2.0 |
| DeepSeek R1 Distill 7B | DeepSeek | Reasoning-heavy prompts and problem solving | 4.68 GB | 12 GB RAM | MIT |
| Qwen2.5 Coder 3B | Qwen Coder | Code snippets, review, and refactors | 2.10 GB | 8 GB RAM | Qwen research |
| Mistral Nemo 12B | Mistral | Higher quality chat on machines with more memory | 7.48 GB | 16 GB RAM | Apache-2.0 |

Models are downloaded as GGUF files and run on-device. You are responsible for reviewing and complying with each model's license.

## Importing Your Own Models

PowerStation can also use local `.gguf` files that you already have.

1. Open Models.
2. Choose an existing `.gguf` file or add a folder containing models.
3. Select the imported model.
4. Start a local chat session.

This is useful if you already manage models manually or want to use a model that is not in the starter catalog yet.

## Runtime Guardrails

PowerStation exposes controls for memory budget, compute cap, context window, idle unload, and low-power bias.

These controls are designed to help users understand and manage local model load. Some limits are advisory because low-level allocation is ultimately handled by llama.cpp and the operating system.

## Updates

PowerStation uses this repository's GitHub Releases for distribution.

macOS updates are currently manual DMG downloads. Automatic in-app replacement requires Developer ID signing and notarization, which is not configured yet.

When signed update releases are enabled, the app can show an Update button in the sidebar. Clicking it will download the latest desktop package and restart into the update when ready.

## Development

PowerStation is built with Electron, React, TypeScript, `node-llama-cpp`, and `systeminformation`.

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

## Project Structure

- `electron/preload.cjs` exposes the controlled desktop bridge to the renderer.
- `electron/llm.ts` owns GGUF model loading, local chat, and model downloading.
- `electron/models.ts` indexes imported and managed model files.
- `electron/telemetry.ts` samples host telemetry.
- `electron/updates.ts` handles GitHub Release update checks.
- `src/modelCatalog.ts` defines the starter model catalog shown on first run and in the Models view.
- `src/` contains the React interface.

## Roadmap

- Public Windows installer releases.
- macOS Developer ID signing and notarization.
- Safer automatic desktop updates.
- More starter models and clearer model recommendations.
- Better per-model memory estimation before download and runtime.
- More detailed GPU support across hardware vendors.
