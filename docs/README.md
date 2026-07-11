# PowerStation documentation

Start here. These guides explain how PowerStation works, how to run and extend it, and what it can
run on your machine.

## Getting started

- **[Quick Start](quick-start.md)** — clone to first local chat in a few minutes.
- **[Source Install](source-install.md)** — safe macOS installation, updates and diagnostics.
- **[Setup Guide](setup.md)** — prerequisites, building, packaging, data locations, troubleshooting.

## How it works

- **[Architecture](architecture.md)** — the process model, the isolated inference worker, IPC, and
  what happens when you send a message.
- **[Memory & monitoring](memory-and-monitoring.md)** — pre-load admission control, memory-pressure
  auto-pause, and honest measured-vs-estimated telemetry (including battery and energy).
- **[Agent harness](agent-harness.md)** — MCP tools, the permission model (trust profiles,
  turn-scoped grants, audit log), capability gating, loop guards, and the built-in repair tools.

## Features

- **[Projects & backup](projects.md)** — workspaces that bundle instructions, knowledge, skills and
  connectors; one-file backup & restore.
- **[Agents](agents.md)** — reusable assistants: instructions + multiple knowledge folders,
  started with one click.
- **[API server](api-server.md)** — serve your model as a localhost OpenAI-compatible endpoint
  for other apps and scripts.
- **[Repair](repair.md)** — storage & health for AI workloads, as a tab and as an agent skill;
  the diagnose-don't-operate contract.

## Models & hardware

- **[Models & devices](models-and-devices.md)** — the full model catalogue, which Mac each model
  needs, Windows/Linux VRAM tiers, imports from Ollama/LM Studio, benchmarks and side-by-side
  compare.

## Project

- **[Contributing](../CONTRIBUTING.md)** — dev setup, conventions, and how to propose a model.
- **[Scope improvements](scope-improvements.md)** — the detailed backlog of deferred items and their status.
- **[Security](../SECURITY.md)** · **[Threat model](../THREAT_MODEL.md)** — the local-first posture and
  the agent attack surface.

← Back to the [project README](../README.md).
