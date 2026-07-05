# PowerStation

**Local AI for your Mac — the agent harness built for small models.**

PowerStation is a desktop app that makes locally-hosted open-weight models genuinely usable: it detects your hardware, recommends the models your machine can honestly run, downloads and sets them up in one click, and gives you a local desktop experience — chat, a system prompt, MCP tools behind permission prompts — with live, truthful resource monitoring the whole time.

Everything runs on your machine. Prompts, chats, and models never leave it.

## Why PowerStation

Existing local-LLM apps tell you whether a model *fits*. Almost none tell you what a model that fits can actually *do*, manage the fit between an agentic workload and your hardware at runtime, or make small models reliable at tool use. PowerStation is built around exactly those three gaps:

1. **Scan, don't ask.** On first run PowerStation reads your chip, unified memory, usable GPU budget, and free disk — then asks only the two things it can't detect: what you want to use AI for, and whether you prefer faster or smarter answers. It recommends up to three models with honest capability cards ("great at / will struggle with"), expected tokens-per-second for your machine class, and a one-click download that ends in a working chat.

2. **Admission control, not an OOM dashboard.** Before any model loads, PowerStation computes weights + KV-cache + buffers against your real memory budget and refuses or shrinks the context *before* your Mac starts swapping — including correct math for 2026 hybrid-attention models whose real KV cost is far below the naive estimate. At runtime it watches macOS memory-pressure signals and auto-pauses generation at critical pressure. The full monitor panel is one click away; a single status pill covers the rest of the time.

3. **An agent harness that respects small models.** MCP servers connect over stdio with every tool call gated by an allow / ask / deny permission model. Tool schemas are token-metered so you can see what connectors cost a small context window. Models that aren't tool-trained get chat only — with the reason stated — instead of present-and-broken agent features. Loop guards halt repeated identical calls and runaway tool budgets.

4. **Crash-isolated runtime.** Inference runs in a separate utility process. If llama.cpp hits a native crash, you get a recovery card with next steps — not a dead app.

## Requirements

- macOS on Apple Silicon (M-series).
- **16 GB unified memory or more.** Below that, PowerStation will tell you honestly that local AI isn't realistic on the machine rather than degrade silently. 24–32 GB is the sweet spot for agents and coding.

Windows and Linux are out of scope for now.

## Download

Releases are published on [GitHub Releases](https://github.com/robbiepeck/PowerStation/releases). The macOS build is currently ad-hoc signed (not yet notarized), so Gatekeeper may warn on first open.

## The model catalog

The catalog is a versioned JSON manifest that lives in this repository ([catalog/models.json](catalog/models.json)) and is fetched at launch — so model recommendations stay current without waiting for an app release. The in-app **Update catalog** button re-fetches it; a bundled copy is the offline fallback. Every entry is verified against Hugging Face and carries the data the app actually uses: exact file size, KV-cache geometry (with effective per-token cost for hybrid-attention models), tool-calling tier, license, minimum RAM tier, and honest good-at / struggles-with notes.

Current spread: 16 GB tier (Qwen3.5 4B, gpt-oss 20B, Gemma 4 E4B) → 24–32 GB tier (GLM-4.7 Flash, Qwen3 Coder 30B, Devstral Small 2, Gemma 4 26B, Nemotron 3 Nano, Qwen3.6 35B) → 64 GB tier (gpt-oss 120B, Qwen3 Coder Next, Qwen3 Next 80B). You can also import any `.gguf` file or folder you already have.

You are responsible for reviewing and complying with each model's license.

## Using MCP tools

1. Open **Utilities** and add an MCP server, e.g. `npx -y @modelcontextprotocol/server-filesystem ~/Documents`.
2. PowerStation connects over stdio and lists the server's tools with a context-cost meter.
3. When the model wants to call a tool, you get a permission prompt — allow once, always allow, or deny. "Always allow" is remembered per tool and editable in Utilities.
4. Agent features unlock based on the selected model's tool-calling tier from the catalog: multi-step models get the full harness; single-call models are capped at 3 tool calls per turn; untrained models stay chat-only.

Tool output is treated as untrusted data, capped in size, and never executed.

## Development

Built with Electron, React, TypeScript, `node-llama-cpp` (bundled runtime — no Ollama required), `@modelcontextprotocol/sdk`, and `systeminformation`.

```bash
npm install          # install dependencies
npm run desktop:dev  # run the app in development
npm test             # unit tests (admission-control math)
npm run build        # typecheck + build renderer and electron
npm run lint         # eslint
npm run package:mac  # package the macOS app (artifacts in release/)
```

### Project structure

- `electron/main.ts` — app lifecycle, telemetry loop, memory-pressure auto-pause.
- `electron/llmWorker.ts` — inference worker (node-llama-cpp) in an isolated utility process; loop guards live here.
- `electron/llm.ts` — main-process host: worker supervision, streaming, crash recovery, downloads.
- `electron/admission.ts` — pre-flight fit math (weights + KV cache + buffers vs budget), unit-tested.
- `electron/hardware.ts` — hardware detection and macOS memory-pressure reads.
- `electron/catalog.ts` / `catalog/models.json` — remotely-updatable model catalog with validation.
- `electron/recommend.ts` — (hardware × intent) → ranked recommendations with reasons.
- `electron/mcp.ts` / `electron/agent.ts` — MCP client manager and the permission-gated tool executor.
- `electron/preload.cjs` — the controlled bridge; renderer never touches Node APIs directly.
- `src/onboarding.tsx` — scan-and-reveal first-run flow.
- `src/` — React interface (chat, monitor, models, utilities, settings).

## Where your data lives

- Models: PowerStation's managed models folder inside the app's user-data directory (revealable per model in the Models view).
- Settings, permissions, and catalog cache: JSON files in the same user-data directory.
- Chats: in memory only — nothing is written unless you copy it out.
- Network traffic: model downloads and catalog updates from `huggingface.co` / this GitHub repo, and update checks against GitHub Releases. Nothing else.

## Roadmap

- macOS Developer ID signing and notarization.
- Skills and connector presets on top of the MCP foundation.
- On-device micro-benchmark after first model load ("your machine: measured N tok/s").
- Optional MLX engine pack for Apple Silicon speed.
- Windows and Linux support.

## License

[MIT](LICENSE)
