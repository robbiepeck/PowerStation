# PowerStation

PowerStation is a desktop GUI for running an open-source local model with visible compute, memory, and power pressure. The current build is an Electron + React MVP with a mock model adapter and simulated host telemetry so the interface can be developed before the base model is selected.

## Current Surface

- Workbench with runtime start/stop, prompt composer, local conversation state, and mock response generation.
- Runtime guardrails for memory budget, compute cap, context window, auto unload, and low power bias.
- Resource monitor with live simulated CPU, RAM, GPU, VRAM, power draw, thermal headroom, prompt load, and tokens/sec.
- Model registry for adapter templates and future model selection.
- Settings screen for safety profile controls.
- Electron desktop shell with a secure preload bridge for future host metrics and model controls.
- Responsive renderer layout that still works in a browser during development.

## Development

Install dependencies:

```bash
npm install
```

Run the renderer in a browser:

```bash
npm run dev
```

The local app runs through Vite. By default:

```bash
http://127.0.0.1:5173/
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

## Checks

```bash
npm run build
npm run lint
```

## Architecture Notes

The model and telemetry behavior are intentionally isolated as adapter-shaped frontend logic for now:

- `useSimulatedTelemetry` should be replaced by a host metrics bridge when the local backend is added.
- `modelProfiles` should be replaced or hydrated by the selected open-source model and runtime metadata.
- `makeMockReply` is the current model-response adapter boundary and should become a streaming local inference adapter.
- `electron/preload.cjs` is the controlled bridge between the renderer and desktop host capabilities.
- Runtime limits are represented in UI state and should be enforced by the backend controller once attached.

## Design

The first visual concept is stored at:

```text
docs/design/powerstation-concept.png
```
