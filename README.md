<div align="center">

<img src="public/favicon.svg" alt="PowerStation logo" width="76" height="76" />

# PowerStation

**A local AI desktop workspace designed to make open-weight models practical on everyday hardware.**

PowerStation recommends models for your machine, runs them locally, and provides chat, retrieval,
agent tools, scheduled jobs, and transparent resource monitoring in one desktop application.

[Get started](docs/quick-start.md) ·
[Documentation](docs/README.md) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md)

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%7C%20Windows%20x64%20%7C%20Linux%20x64-111111)
![License](https://img.shields.io/badge/license-MIT-008476)
![Status](https://img.shields.io/badge/status-beta-b17018)
[![CI](https://github.com/robbiepeck/PowerStation/actions/workflows/ci.yml/badge.svg)](https://github.com/robbiepeck/PowerStation/actions/workflows/ci.yml)

</div>

## Overview

Running a model locally involves more than finding one that fits on disk. The model must fit the
available memory at the intended context length, perform well enough for the task, and expose only
the capabilities it can use reliably. PowerStation handles those decisions before inference starts.

On first run, the application detects the available hardware and recommends up to three models based
on the user's workload and speed preference. Each recommendation explains its strengths, limitations,
expected performance, and memory fit. The selected model is downloaded and opened in a ready-to-use
chat workspace.

Inference, chats, attachments, indexes, settings, and managed models remain on the device. Network
access is used only for explicit features such as model downloads, catalogue and update checks, and
network-enabled MCP connectors. See [Security](SECURITY.md) for the complete data-flow summary.

## Key capabilities

- **Hardware-aware model selection** — detects memory, accelerator capacity, and free storage;
  recommends models with clear capability and performance trade-offs.
- **Pre-load admission control** — estimates weights, context cache, and compute buffers before a
  model is loaded; reduces context or refuses the load when necessary.
- **Local chat and retrieval** — persistent conversations, text/code/PDF attachments, local folder
  indexing, source citations, long-conversation compaction, and rendered artifacts.
- **Small-model agent harness** — skills, Model Context Protocol (MCP) connectors, model capability
  gating, per-tool permissions, change previews, loop limits, and a persistent audit log.
- **Reusable projects and agents** — scoped instructions, knowledge folders, skills, connectors,
  and preferred models for repeatable workflows.
- **Scheduled inference** — bounded, timezone-aware recurring prompts with battery, overlap, and
  missed-run safeguards. Scheduled jobs cannot use tools or connectors.
- **OpenAI-compatible local API** — an optional token-protected endpoint bound to `127.0.0.1` for
  local applications and scripts.
- **Resource and storage visibility** — measured or clearly labelled estimated telemetry, model
  benchmarks, model comparison, integrity checks, and conservative cleanup of app-owned data.

## Platform support

| Platform | Status | Notes |
| --- | --- | --- |
| macOS on Apple Silicon | Primary | Supported source installer; 16 GB unified memory minimum. |
| Windows 10/11 x64 | Beta | Runs from source; a discrete GPU with at least 8 GB VRAM is recommended. |
| Linux x64 | Beta | Runs from source; Debian/Ubuntu are the primary packaging test targets. |

PowerStation requires Node.js 22 or newer and at least 16 GB of system memory. Windows and Linux
packages are built and launch-tested in CI but are not currently published as consumer downloads.

## Installation

Public releases are source-only. On macOS, the supported installation command builds and ad-hoc
signs PowerStation on the destination Mac. This avoids distributing an unsigned, unnotarized
application and does not require an Apple Developer account.

### macOS

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm run doctor
npm run install:mac
```

The installer checks prerequisites, installs locked dependencies, builds and verifies the app,
then places it in `/Applications` or `~/Applications`. Existing settings, chats, and models are
preserved. See [Install from source](docs/source-install.md) for updates and troubleshooting.

### Windows and Linux

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm ci
npm run desktop:dev
```

Keep the terminal open while the application is running. Windows and Linux support remains beta;
see the [setup guide](docs/setup.md) for platform-specific prerequisites and packaging commands.

## How PowerStation protects the host

Before a model loads, PowerStation estimates:

```text
required memory ≈ model weights + KV cache + compute buffers
```

That estimate is compared with the accelerator budget and reserved operating-system headroom. The
result is reported as comfortable, tight, or unable to fit. When possible, PowerStation reduces the
context length or uses CPU offload; otherwise it refuses the load before the machine begins swapping.
During inference, memory-pressure monitoring can pause generation and present recovery options.

Tool use has a separate trust boundary. New tools ask for permission by default, file mutations show
a diff, and repeated calls are bounded. Tool output is treated as untrusted input. Details are in
[Memory and monitoring](docs/memory-and-monitoring.md), the [agent harness guide](docs/agent-harness.md),
and the [threat model](THREAT_MODEL.md).

## Documentation

| Guide | Purpose |
| --- | --- |
| [Documentation index](docs/README.md) | All user, contributor, architecture, and roadmap documentation. |
| [Quick start](docs/quick-start.md) | Install PowerStation and complete the first local chat. |
| [Source installation](docs/source-install.md) | Supported macOS install, update, and diagnostics workflow. |
| [Setup](docs/setup.md) | Development prerequisites, scripts, packaging, and troubleshooting. |
| [Architecture](docs/architecture.md) | Process isolation, IPC, inference, retrieval, and scheduled execution. |
| [Models and devices](docs/models-and-devices.md) | Supported hardware, catalogue models, imports, and benchmarks. |
| [Agent harness](docs/agent-harness.md) | Skills, connectors, permissions, capability gating, and loop guards. |
| [Projects and backup](docs/projects.md) | Workspace configuration and portable local backups. |
| [Agents](docs/agents.md) | Reusable assistants with instructions, knowledge, and connector scope. |
| [Schedules](docs/schedules.md) | Safe recurring local inference and run history. |
| [Local API server](docs/api-server.md) | OpenAI-compatible localhost endpoints and security boundaries. |
| [Repair](docs/repair.md) | Storage inspection, integrity checks, and app-owned cleanup. |

## Data and network boundaries

PowerStation stores application data in the operating system's standard user-data directory:

- managed model files and downloaded embedding models;
- settings, permissions, catalogue cache, and benchmark results;
- saved chats and extracted attachment text;
- folder indexes, projects, agents, skills, schedules, and repair history.

The application contacts GitHub for catalogue and release checks and Hugging Face for model files.
Optional web-enabled MCP connectors communicate with their configured services when the user enables
and invokes them. Custom MCP servers run with the current operating-system user's permissions and
should be treated as trusted local software.

## Development

PowerStation is built with Electron, React, TypeScript, `node-llama-cpp`, the Model Context Protocol
SDK, and `systeminformation`.

```bash
npm ci
npm run desktop:dev
```

Before opening a pull request, run:

```bash
npm run build
npm run lint
npm test
```

See [Contributing](CONTRIBUTING.md) for repository conventions, security expectations, and catalogue
changes. Contributions to the application, documentation, tests, and model catalogue are welcome.

## Project status

PowerStation is beta software. macOS on Apple Silicon is the primary development platform; Windows
and Linux receive CI coverage but have had less real-world testing. Please report reproducible bugs
through [GitHub Issues](https://github.com/robbiepeck/PowerStation/issues) and security issues through
the private process in [Security](SECURITY.md).

## License

PowerStation is available under the [MIT License](LICENSE).
