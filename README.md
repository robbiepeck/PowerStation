# PowerStation

PowerStation is a Mac and Windows desktop GUI for running an open-source local model with visible compute, memory, and power pressure. The app is Electron-based and requires the desktop host bridge for local model inference, model file access, and host telemetry.

## Current Surface

- Workbench with local prompt composer, conversation state, and streamed local model responses.
- Runtime guardrails for memory budget, compute cap, context window, auto unload, and low power bias.
- Resource monitor with desktop host CPU, RAM, GPU/VRAM where available, estimated power draw, thermal headroom, and tokens/sec.
- Model registry for adapter templates and future model selection.
- Settings screen for safety profile controls.
- Electron desktop shell with a secure preload bridge for host metrics and model controls.
- No browser/web version is supported.

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run desktop:dev
```

## Windows Build

Build the Windows x64 desktop package:

```bash
npm run package:win
```

Build an unpacked Windows directory, which is useful for quick packaging checks:

```bash
npm run package:win:dir
```

Windows artifacts are written to `release/`.

## macOS Build

Build the universal macOS desktop package for Apple Silicon and Intel Macs:

```bash
npm run package:mac
```

Build an unpacked macOS app directory, which is useful for quick packaging checks:

```bash
npm run package:mac:dir
```

macOS artifacts are written to `release/`.

Production macOS distribution should use Apple Developer ID signing and notarization. Unsigned local builds may trigger Gatekeeper warnings.

## Checks

```bash
npm run build
npm run lint
```

## Architecture Notes

The model and telemetry behavior are intentionally isolated as adapter-shaped frontend logic for now:

- `electron/preload.cjs` is the controlled bridge between the renderer and desktop host capabilities.
- `electron/llm.ts` owns the local GGUF runtime through `node-llama-cpp`.
- `electron/telemetry.ts` samples desktop host telemetry through `systeminformation` and `node-llama-cpp` where available.
- Runtime limits are represented in UI state and should be enforced by the backend controller.

## Design

The first visual concept is stored at:

```text
docs/design/powerstation-concept.png
```
