# PowerStation

PowerStation is a locally hosted GUI for running an open-source local model with visible compute, memory, and power pressure. The current build is a frontend MVP with a mock model adapter and simulated host telemetry so the interface can be developed before the base model is selected.

## Current Surface

- Workbench with runtime start/stop, prompt composer, local conversation state, and mock response generation.
- Runtime guardrails for memory budget, compute cap, context window, auto unload, and low power bias.
- Resource monitor with live simulated CPU, RAM, GPU, VRAM, power draw, thermal headroom, prompt load, and tokens/sec.
- Model registry for adapter templates and future model selection.
- Settings screen for safety profile controls.
- Responsive desktop and mobile layouts.

## Development

```bash
npm install
npm run dev
```

The local app runs through Vite. By default:

```bash
http://127.0.0.1:5173/
```

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
- Runtime limits are represented in UI state and should be enforced by the backend controller once attached.

## Design

The first visual concept is stored at:

```text
docs/design/powerstation-concept.png
```
