<div align="center">

<img src="public/favicon.svg" alt="PowerStation" width="76" height="76" />

# PowerStation

**Local AI for your Mac — the agent harness built for small models.**

Guided model choice for your exact hardware, a local desktop workspace with
skills, MCP tools and an agent harness, and honest resource monitoring — all running
on open-weight models, entirely on your machine.

[Quick Start](docs/quick-start.md) ·
[Setup Guide](docs/setup.md) ·
[Contributing](CONTRIBUTING.md) ·
[Roadmap](ROADMAP.md)

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20·%20Windows%20x64-111111?logo=apple&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-008476)
![Status](https://img.shields.io/badge/status-beta-b17018)
[![CI](https://github.com/robbiepeck/PowerStation/actions/workflows/ci.yml/badge.svg)](https://github.com/robbiepeck/PowerStation/actions/workflows/ci.yml)

</div>

---

PowerStation makes locally-hosted open-weight models genuinely usable. It detects your
hardware, recommends the models your machine can honestly run, downloads and sets them up
in one click, and gives you a chat + agent experience with live, truthful resource
monitoring the whole time.

**Everything runs on your machine. Prompts, chats, documents and models never leave it.**
Attach files (text, code, PDF) or a whole folder — indexed and retrieved with a local embedding
model — and chat with your documents entirely offline.

## Why PowerStation

Existing local-LLM apps tell you whether a model *fits*. Almost none tell you what a model
that fits can actually *do*, manage the fit between an agentic workload and your hardware
at runtime, or make small models reliable at tool use. PowerStation is built around exactly
those three gaps:

1. **Scan, don't ask.** On first run PowerStation reads your chip, unified memory, usable
   GPU budget and free disk — then asks only the two things it can't detect: what you want
   to use AI for, and whether you prefer faster or smarter answers. It recommends up to
   three models with honest "great at / will struggle with" capability cards, expected
   tokens-per-second for your machine, and a one-click download that ends in a working chat.

2. **Admission control, not an OOM dashboard.** Before any model loads, PowerStation computes
   weights + context cache + buffers against your real memory budget and refuses or shrinks
   the context *before* your Mac starts swapping. At runtime it watches the macOS
   memory-pressure signal and auto-pauses generation if the system gets into trouble.
   → [Memory & monitoring](docs/memory-and-monitoring.md)

3. **An agent harness that respects small models.** A one-click **connector gallery** (local files,
   memory, web reading, web search…) and **skills** — reusable instruction packs with starters
   included and in-app editing. MCP servers connect over stdio with every tool call gated by an
   allow / ask / deny permission model; tool schemas and skills are token-metered. Models that
   aren't tool-trained get chat only — with the reason stated — instead of present-and-broken
   agent features. → [Agent harness](docs/agent-harness.md)

## Requirements

- **macOS on Apple Silicon** (M-series) — the primary platform — or **Windows 10/11 x64** (beta).
- **16 GB memory or more.** Below that, PowerStation tells you honestly that local AI isn't
  realistic on the machine rather than degrade silently. On a Mac, 24–32 GB unified memory is the
  sweet spot for agents and coding; on Windows, a discrete GPU (8 GB+ VRAM) makes the same
  difference — models larger than your GPU still run via CPU offload, just slower, and the app
  says so up front.

Windows support is new and CI-built but less battle-tested than macOS — issues welcome. Linux is
on the [Roadmap](ROADMAP.md).

## Download

Grab the latest installer from **[Releases](https://github.com/robbiepeck/PowerStation/releases/latest)** —
macOS (Apple Silicon `.dmg`) and Windows x64 (installer or portable). Builds are not yet
code-signed, so Gatekeeper/SmartScreen will warn on first launch (right-click → Open on macOS;
"More info → Run anyway" on Windows).

## Quick Start (from source)

```bash
git clone https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm install
npm run desktop:dev
```

On first launch PowerStation scans your Mac, asks two questions, recommends models, and
downloads your pick straight into a working chat. Full walkthrough in the
[Quick Start guide](docs/quick-start.md); native-build prerequisites, packaging and
troubleshooting in the [Setup Guide](docs/setup.md).

## Documentation

| Guide | What's inside |
| --- | --- |
| [Quick Start](docs/quick-start.md) | From clone to first local chat in a few minutes. |
| [Setup Guide](docs/setup.md) | Prerequisites, building, packaging, data locations, troubleshooting. |
| [Architecture](docs/architecture.md) | How the app works: processes, the isolated inference worker, IPC, data flow. |
| [Models & devices](docs/models-and-devices.md) | The full model catalogue and which Mac each model needs. |
| [Memory & monitoring](docs/memory-and-monitoring.md) | The admission-control math, auto-pause, and honest telemetry. |
| [Agent harness](docs/agent-harness.md) | MCP tools, permissions, capability gating, loop guards. |
| [Projects & backup](docs/projects.md) | Workspaces that bundle instructions, knowledge, skills, connectors; one-file backup. |
| [Contributing](CONTRIBUTING.md) | Dev setup, how the catalogue works, proposing a model. |
| [Roadmap](ROADMAP.md) | What's next. |
| [Security](SECURITY.md) · [Threat model](THREAT_MODEL.md) | The local-first posture and the agent attack surface. |

## The model catalogue

The catalogue is a versioned JSON manifest that lives in this repository
([`catalog/models.json`](catalog/models.json)) and is fetched at launch — so recommendations
stay current without waiting for an app release. The in-app **Update catalog** button
re-fetches it; a bundled copy is the offline fallback. Every entry is verified against
Hugging Face and carries the data the app actually uses: exact file size, KV-cache geometry
(with effective per-token cost for hybrid-attention models), tool-calling tier, licence,
minimum RAM tier and honest capability notes.

See **[Models & devices](docs/models-and-devices.md)** for the full table and per-machine
guidance. You can also import any `.gguf` file or folder you already have.

## Where your data lives

- **Models** — PowerStation's managed models folder inside the app's user-data directory.
- **Settings, permissions, catalog cache, benchmarks** — JSON files in the same user-data directory.
- **Chats** — saved locally as plain JSON files (one per conversation) so they survive restarts;
  revealable and deletable from Settings, and saving can be turned off entirely.
- **Attachments & folder indexes** — extracted file text lives with its chat; folder indexes and
  the small embedding model live in the same user-data directory.
- **Network** — model downloads and catalogue updates from `huggingface.co` / this GitHub
  repo, and update checks against GitHub Releases. Nothing else — attachments and folder
  retrieval are fully local.

More detail in [Security](SECURITY.md) and the [Threat model](THREAT_MODEL.md).

## Development

Built with Electron, React, TypeScript, `node-llama-cpp` (bundled runtime — no Ollama
required), `@modelcontextprotocol/sdk` and `systeminformation`.

```bash
npm run desktop:dev  # run the app in development
npm test             # unit tests (admission-control math)
npm run build        # typecheck + build renderer and electron
npm run lint         # eslint
npm run package:mac  # package the macOS app (artifacts in release/)
```

See the [Setup Guide](docs/setup.md) and [Architecture](docs/architecture.md) to go deeper,
and [Contributing](CONTRIBUTING.md) before opening a PR.

## License

[MIT](LICENSE)
