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
- **Windows x64 support (beta)** — platform-aware hardware detection and memory pressure, a
  CPU-offload fit tier for discrete-GPU machines, and a CI-built NSIS installer + portable exe.
- **Ollama & LM Studio import** — one click registers models you already have on disk, no
  re-download; inference stays in PowerStation's own runtime with the same admission checks.
- **Turn-scoped tool approval** — "Allow rest of turn" in the permission dialog; battery-aware
  status pill and a per-chat energy estimate.
- **Projects (workspaces) + backup** — instructions, knowledge folder, skills, connectors and
  model bundled per workspace; one-file backup & restore. See [projects.md](docs/projects.md).

## Next

- **macOS Developer ID signing & notarization** — a prerequisite for a friction-free consumer
  release (no Gatekeeper warning). The blocker before any public binary.
- ~~**On-device speed micro-benchmark**~~ — shipped in v0.2: measured tokens/sec on your exact
  machine, shown on every card and recommendation.
- ~~**Skills & connector presets**~~ — shipped in v0.3: markdown skills (five starters, in-app
  editing, token metering) and a curated one-click connector gallery. Next iteration:
  relevance-triggered skills.
- **Recommendation polish** — richer capability tiers and a "why this over that" comparison in the
  onboarding results.

## Later

- **MLX engine pack for Apple Silicon** — designed ([plan](docs/mlx-engine-plan.md)); staged after
  signing. An optional faster backend shipped as a managed subprocess engine.
- **Vision (image input)** — groundwork shipped, blocked on multimodal support in the bundled
  runtime; verified gap analysis and the two delivery paths in [docs/vision-plan.md](docs/vision-plan.md).
  A CI watchdog flags every new runtime release so the unblock is caught immediately.
- ~~**Optional detected Ollama backend**~~ — shipped in v0.4: Ollama models import with one click
  (no re-download); chatting through the daemon itself remains out of scope.
- **Windows polish** — deeper GPU detection (multi-GPU, AMD), Windows code signing (SmartScreen),
  and catalogue guidance written for VRAM tiers rather than unified memory.
- **Linux support** — hardware detection and runtime variants per distro.

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
