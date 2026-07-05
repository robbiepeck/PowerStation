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

## Next

- **macOS Developer ID signing & notarization** — a prerequisite for a friction-free consumer
  release (no Gatekeeper warning). The blocker before any public binary.
- **On-device speed micro-benchmark** — a short generation after first load to show *measured*
  tokens-per-second for your exact machine, making every subsequent recommendation credible.
- **Skills & connector presets** — building on the MCP foundation, curated one-click tool bundles
  and reusable skills (the Utilities panel currently exposes the primitives).
- **Recommendation polish** — richer capability tiers and a "why this over that" comparison in the
  onboarding results.

## Later

- **MLX engine pack for Apple Silicon** — an optional faster backend (MLX outruns llama.cpp on Metal
  for many models) shipped as a subprocess engine, following the multi-runtime pattern.
- **Optional detected Ollama backend** — use an existing Ollama install if present, without making it
  a dependency.
- **Windows polish** — deeper GPU detection (multi-GPU, AMD), Windows code signing (SmartScreen),
  and catalogue guidance written for VRAM tiers rather than unified memory.
- **Linux support** — hardware detection and runtime variants per distro.
- **Conversation persistence** — opt-in, local, with the same transparency as everything else.

## Explicitly out of scope (for now)

- **Cloud fallback** — PowerStation is strictly local. Tasks that exceed local capability end with an
  honest limit, not a silent hop to a hosted model.
- **Storage-cleanup / device-repair features** — these belonged to an earlier, broader concept and
  were cut to keep the product focused on local AI.

Have a request? Open an issue — see [Contributing](CONTRIBUTING.md).
