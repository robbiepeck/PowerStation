<div align="center">

<img src="public/favicon.svg" alt="PowerStation" width="76" height="76" />

# PowerStation

**Local AI for your computer — the agent harness built for small models.**

Created and maintained by Robbie Peck.

Guided model choice for your exact hardware, a local desktop workspace with
skills, MCP tools and an agent harness, and honest resource monitoring — all running
on open-weight models, entirely on your machine.

[Quick Start](docs/quick-start.md) ·
[Source Install](docs/source-install.md) ·
[Setup Guide](docs/setup.md) ·
[Contributing](CONTRIBUTING.md)

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20·%20Windows%20x64%20·%20Linux%20x64-111111?logo=linux&logoColor=white)
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
   the context *before* your machine starts swapping. At runtime it watches the operating system's
   memory-pressure signal and auto-pauses generation if the system gets into trouble.
   → [Memory & monitoring](docs/memory-and-monitoring.md)

3. **An agent harness that respects small models.** A one-click **connector gallery** (local files,
   memory, web reading, web search…) and **skills** — reusable instruction packs with starters,
   a curated gallery, and in-app editing. Every tool call is gated by an allow / ask / deny
   permission model with **real diff previews**, turn-scoped grants ("allow rest of turn"),
   **trust profiles** (cautious mode makes every call ask), and a per-chat **audit log** of every
   call, decision, and outcome. Models that aren't tool-trained get chat only — with the reason
   stated — instead of present-and-broken agent features. → [Agent harness](docs/agent-harness.md)

## What's in the box

- **Chat that keeps up** — persistent chats (pin, rename, search, export), file and PDF
  attachments, **chat-with-a-folder** (local embeddings, cited sources), regenerate/edit,
  auto-compaction for long conversations, and an artifacts pane for rendered HTML/SVG.
- **Projects (workspaces)** — bundle instructions, a knowledge folder, skill modes, a connector
  selection, and a preferred model; switch context in one click. → [Projects & backup](docs/projects.md)
- **Agents** — reusable assistants with instructions, up to eight knowledge folders, and a
  connector selection; answer with folder-prefixed citations, export/import as a file, and
  optionally preview a turn's plan before it runs. → [Agents](docs/agents.md)
- **Scheduled jobs** — recurring, timezone-aware prompts against a pinned installed model, with
  missed-run and battery safeguards, bounded execution, notifications, and a durable local ledger.
  Unattended runs are inference-only: no tools, shell, or connectors. → [Schedules](docs/schedules.md)
- **Honest model choice** — measured on-device benchmarks (read *and* write speed), side-by-side
  **model compare**, recommendations that explain *why this over that*, and one-click import of
  models you already have in **Ollama or LM Studio** (no re-download).
- **Repair without snake oil** — storage intelligence for AI files, cross-app duplicate detection,
  and cleanup strictly limited to PowerStation's own data — as a tab, and as an opt-in **agent
  skill** driving the same guarded tools. → [Repair](docs/repair.md)
- **Local API server** — serve your running model as an OpenAI-compatible endpoint on
  `127.0.0.1` so other apps and scripts can call it with the OpenAI SDK; off by default,
  token-gated. → [API server](docs/api-server.md)
- **Backup & restore** — one readable JSON archive of settings, permissions, skills, chats,
  projects, agents, and scheduled-job definitions.
- **Truthful telemetry** — live CPU/RAM/VRAM/pressure/battery, every figure labelled measured or
  estimated, plus a per-chat energy estimate. → [Memory & monitoring](docs/memory-and-monitoring.md)

## Requirements

- **macOS on Apple Silicon** (M-series) — the primary platform — **Windows 10/11 x64** (beta), or
  **Linux x64** (beta; AppImage or Debian package).
- **16 GB memory or more.** Below that, PowerStation tells you honestly that local AI isn't
  realistic on the machine rather than degrade silently. On a Mac, 24–32 GB unified memory is the
  sweet spot for agents and coding; on Windows/Linux, a discrete GPU (8 GB+ VRAM) makes the same
  difference when the native runtime can use it — models larger than your GPU still run via CPU
  offload, just slower, and the app says so up front. Multi-GPU Windows/Linux machines are ranked
  by detected discrete NVIDIA/AMD VRAM until the runtime reports its exact backend memory.

Windows and Linux support are CI-built but less battle-tested than macOS — issues welcome.

## Install

Public releases are source-only. On macOS, the supported installer builds and ad-hoc signs the app
on your own Mac—no paid Apple Developer account and no downloaded, unnotarized binary.

## Quick Start (macOS)

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm run doctor
npm run install:mac
```

On first launch PowerStation scans your machine, asks two questions, recommends models, and
downloads your pick straight into a working chat. Full walkthrough in the
[Quick Start guide](docs/quick-start.md); installation, updates, safe diagnostics and
troubleshooting in the [Source Install guide](docs/source-install.md).

Windows and Linux are beta and currently run from a stable source checkout; see the exact commands
in the [Setup Guide](docs/setup.md). CI installs and launches the Windows installer, Linux Debian
package and AppImage, and locally built macOS app on clean target-platform runners. Those unsigned
artifacts verify the project but are not public releases.

## Documentation

| Guide | What's inside |
| --- | --- |
| [Quick Start](docs/quick-start.md) | From clone to first local chat in a few minutes. |
| [Source Install](docs/source-install.md) | Safe macOS install, update, diagnostics and troubleshooting. |
| [Setup Guide](docs/setup.md) | Prerequisites, building, packaging, data locations, troubleshooting. |
| [Architecture](docs/architecture.md) | How the app works: processes, the isolated inference worker, IPC, data flow. |
| [Models & devices](docs/models-and-devices.md) | The full model catalogue and what hardware each model needs. |
| [Memory & monitoring](docs/memory-and-monitoring.md) | The admission-control math, auto-pause, and honest telemetry. |
| [Agent harness](docs/agent-harness.md) | MCP tools, permissions, capability gating, loop guards. |
| [Projects & backup](docs/projects.md) | Workspaces that bundle instructions, knowledge, skills, connectors; one-file backup. |
| [Agents](docs/agents.md) | Reusable assistants: instructions + multiple knowledge folders, started with one click. |
| [Schedules](docs/schedules.md) | Safe recurring local-model jobs, cron syntax, lifecycle and run history. |
| [API server](docs/api-server.md) | Serve your model as a localhost OpenAI-compatible endpoint for other apps. |
| [Repair](docs/repair.md) | Storage & health for AI workloads — diagnose and reveal, never touch system files. |
| [Contributing](CONTRIBUTING.md) | Dev setup, how the catalogue works, proposing a model. |
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
- **Projects, agents & skills** — one JSON file per workspace (`projects/`) and per agent
  (`agents/`), one markdown file per skill (`skills/`) — all revealable and editable outside the app.
- **Repair log & backups** — everything the Repair tab (or skill) ever removed is listed in
  `repair-log.json`; backups are single JSON archives written wherever you choose.
- **Network** — model downloads and catalogue updates from `huggingface.co` / this GitHub
  repo, and update checks against GitHub Releases. Nothing else — attachments and folder
  retrieval are fully local.

More detail in [Security](SECURITY.md) and the [Threat model](THREAT_MODEL.md).

## Development

Built with Electron, React, TypeScript, `node-llama-cpp` (bundled runtime — no Ollama
required), `@modelcontextprotocol/sdk` and `systeminformation`.

```bash
npm run desktop:dev  # run the app in development
npm test             # unit tests (admission math, formats, repair guards, recommender…)
npm run build        # typecheck + build renderer and electron
npm run lint         # eslint
npm run package:mac  # package the macOS app (artifacts in release/)
```

See the [Setup Guide](docs/setup.md) and [Architecture](docs/architecture.md) to go deeper,
and [Contributing](CONTRIBUTING.md) before opening a PR.

## License

[MIT](LICENSE)
