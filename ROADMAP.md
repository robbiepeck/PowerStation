# Roadmap

Where PowerStation is headed. This is a direction, not a dated commitment — priorities shift with the
model landscape and with what users hit first.

## Now (shipped)

- Scan-and-reveal onboarding: auto-detect hardware, ask only intent and speed-vs-quality.
- Remotely-updatable, verified model catalogue with capability-aware recommendations.
- Pre-load admission control (weights + KV cache + buffers vs measured budget), with unit tests.
- Crash-isolated inference runtime with recovery cards and respawn cooldown.
- Agent harness: MCP tools over stdio, allow/ask/deny permissions, context metering, loop guards.
- Capability gating by model tier; memory-pressure auto-pause; ambient status pill + full monitor.
- MIT licence; local-first data posture.
- **Windows x64 support (beta)** — platform-aware hardware detection and memory pressure, ranked
  multi-GPU NVIDIA/AMD VRAM detection, a CPU-offload fit tier for discrete-GPU machines, VRAM-tier
  catalogue guidance, tagged-release code-signing enforcement, and a CI-built NSIS installer +
  portable exe.
- **Linux x64 support (beta)** — AppImage and deb packaging on native Linux CI, derived
  memory-pressure monitoring, and AppImage update metadata.
- **Ollama & LM Studio import** — one click registers models you already have on disk, no
  re-download; inference stays in PowerStation's own runtime with the same admission checks.
- **Turn-scoped tool approval** — "Allow rest of turn" in the permission dialog; battery-aware
  status pill and a per-chat energy estimate.
- **Projects (workspaces) + backup** — instructions, knowledge folder, skills, connectors and
  model bundled per workspace; one-file backup & restore. See [projects.md](docs/projects.md).
- **Model choice with evidence** — measured read/write benchmarks, side-by-side compare, and
  "why this over that" recommendations (v0.13).
- **Repair** — storage & health for AI workloads as a tab (v0.12) and as an opt-in agent skill
  (v0.14) driving the same guarded tools. See [repair.md](docs/repair.md).
- **Agent trust profiles** — Trusted vs Cautious (every call asks); turn-scoped grants; per-chat
  audit log.
- **Agents (workspaces' faster cousin)** — reusable assistants with instructions + multiple
  knowledge folders + connectors (v0.15–v0.16); export/import as a file; **plan preview** that
  proposes a turn's steps for one-shot approval. See [agents.md](docs/agents.md).
- **Local API server** — serve your model as a localhost OpenAI-compatible endpoint (v0.18);
  off by default, token-gated, raw inference. See [api-server.md](docs/api-server.md).
- **Delete installed models** to reclaim disk space (v0.17), including every part of a split GGUF.

## Next

- **macOS Developer ID signing & notarization** — a prerequisite for a friction-free consumer
  release (no Gatekeeper warning). The blocker before any public binary — and the gate in front
  of the MLX engine pack. The app is at v0.16 but the last *packaged* release is v0.7.0; cutting a
  fresh release is the highest-value next step.
- **Menu-bar quick chat + global hotkey** — summon the local model from anywhere; pure Electron
  work on top of the existing chat stack.
- **Agent gallery** — a curated, remotely-updatable `catalog/agents.json` (same pattern as skills
  and connectors) so useful agents install with one click.
- **Local voice, verified first** — system-voice TTS is nearly free; speech input depends on
  whisper.cpp bindings that will be verified before anything ships (the same discipline as
  vision).
- **Project templates** — a few starter workspaces so Projects are discoverable.

## Later

- **MLX engine pack for Apple Silicon** — designed ([plan](docs/mlx-engine-plan.md)); staged after
  signing. An optional faster backend shipped as a managed subprocess engine.
- **Vision (image input)** — groundwork shipped, blocked on multimodal support in the bundled
  runtime; verified gap analysis and the two delivery paths in [docs/vision-plan.md](docs/vision-plan.md).
  A CI watchdog flags every new runtime release so the unblock is caught immediately.
- ~~**Optional detected Ollama backend**~~ — shipped in v0.4: Ollama models import with one click
  (no re-download); chatting through the daemon itself remains out of scope.
- **Linux polish** — broader distro validation, GPU-runtime notes per driver stack, and optional
  package formats beyond AppImage/deb if demand appears.

## Explicitly out of scope (for now)

- **Cloud fallback** — PowerStation is strictly local. Tasks that exceed local capability end with an
  honest limit, not a silent hop to a hosted model.
- **General "Mac cleaner" / device-repair features** — the broad concept stays out. What shipped
  instead (v0.12) is a deliberately narrow **Repair tab**: read-only storage diagnostics focused on
  AI files, reveal-don't-delete for anything PowerStation didn't create, and cleanup strictly of the
  app's own data — see [docs/repair.md](docs/repair.md) for the contract. System-file surgery,
  plist/permission "fixes", and speed-up claims remain permanently out of scope.

The detailed backlog with per-item status lives in
[docs/scope-improvements.md](docs/scope-improvements.md).

Have a request? Open an issue — see [Contributing](CONTRIBUTING.md).
