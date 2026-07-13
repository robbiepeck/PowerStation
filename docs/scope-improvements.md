# Product roadmap

This roadmap summarises delivered capabilities, active design proposals, deferred work, and explicit
non-goals. It is directional rather than a release commitment. Version history remains authoritative
in the [changelog](../CHANGELOG.md).

## Status definitions

| Status | Meaning |
| --- | --- |
| Shipped | Available in a tagged release. |
| Designed | A public technical proposal exists, but implementation has not started or completed. |
| Blocked | Groundwork may exist, but a named external or architectural dependency prevents delivery. |
| Deferred | Potentially valuable, but not prioritised for the current product scope. |
| Not planned | Explicitly outside the current product direction. |

## Current roadmap

| Capability | Status | Release or next condition |
| --- | --- | --- |
| Hardware-aware model recommendations | Shipped | v0.1, with continued catalogue maintenance. |
| On-device read/write benchmark | Shipped | v0.2. |
| Persistent local conversations | Shipped | v0.2. |
| Skills and MCP connector gallery | Shipped | v0.3; relevance modes added in v0.6. |
| Catalogue freshness automation | Shipped | v0.4. |
| Ollama model import | Shipped | v0.4. |
| Attachments and local folder retrieval | Shipped | v0.5. |
| Tool diffs, artifacts, and skill activation modes | Shipped | v0.6. |
| Automatic conversation compaction | Shipped | v0.7. |
| Skill gallery | Shipped | v0.8. |
| Tool audit log | Shipped | v0.9. |
| LM Studio import and chat organisation | Shipped | v0.10. |
| Turn-scoped tool approval | Shipped | v0.10. |
| Battery and energy indicators | Shipped | v0.10. |
| Projects and backup/restore | Shipped | v0.11. |
| Repair and storage health | Shipped | v0.12; model-driven skill added in v0.14. |
| Side-by-side model comparison | Shipped | v0.13. |
| Agent trust profiles | Shipped | v0.13. |
| Reusable agents | Shipped | v0.15; import/export and connector scope added in v0.16. |
| Plan preview for tool turns | Shipped | v0.16. |
| Local OpenAI-compatible API | Shipped | v0.18. |
| Stable source installation and platform package smoke tests | Shipped | v0.18.1–v0.19.1. |
| Scheduled local inference | Shipped | v0.19. |
| Vision input | Blocked | Re-evaluate when the packaged runtime exposes compatible multimodal APIs. |
| Optional MLX engine | Designed | Requires secure runtime-pack delivery and engine-specific admission data. |
| Public web model recommender | Deferred | Revisit after desktop distribution and documentation mature. |
| Signed macOS and Windows binaries | Deferred | Requires maintained platform signing and notarisation infrastructure. |

## Delivered foundations

### Model selection and performance

PowerStation detects hardware, estimates model fit, and provides catalogue recommendations for a
selected workload. Installed models can be benchmarked on the current device and compared
sequentially with first-token latency, read speed, write speed, and total time. Existing GGUF models
can be imported directly or registered in place from supported Ollama and LM Studio stores.

### Local workspace

Chats persist as readable local files and support attachments, indexed folders, source citations,
editing, regeneration, search, export, artifacts, and automatic compaction. Projects apply shared
instructions, knowledge, skills, connectors, and a preferred model. Backups include portable
configuration and user content while excluding model weights and derived indexes.

### Agent controls

Skills apply reusable instructions. Compatible models can invoke MCP or built-in tools through
per-tool permissions, file-change previews, turn-scoped grants, trust profiles, plan preview, loop
limits, and a durable audit log. Reusable agents combine instructions, multiple knowledge folders,
and connector scope without binding a model.

### Operations and reliability

Admission control evaluates memory requirements before model loading. Telemetry distinguishes
measured values from estimates. Repair checks storage and model integrity while restricting deletion
to allowlisted, rebuildable PowerStation data. Scheduled jobs execute bounded inference without tools,
connectors, project context, or retrieval.

### Distribution

Stable releases are currently source-only. macOS users can build, verify, ad-hoc sign, and install a
tagged release through project scripts. CI builds and launch-tests platform packages, but unsigned
artifacts are not distributed as supported consumer downloads.

## Designed or blocked work

### Vision input

Vision metadata and freshness checks are present for compatible catalogue models. The current
`node-llama-cpp` API does not expose the required multimodal path, so no image-input UI or projector
download ships. See the [vision input proposal](vision-plan.md).

### Optional MLX engine

An MLX engine may improve throughput on Apple Silicon, but it requires a verified runtime pack, an
engine abstraction, separate model variants, engine-specific memory modelling, and comparable
benchmarks. See the [MLX engine proposal](mlx-engine-plan.md).

## Deferred work

### Public web recommender

A static, browser-based version of the model-selection questionnaire could help prospective users
understand hardware requirements before installing the application. It remains secondary to desktop
distribution, documentation, and catalogue quality.

### Signed consumer binaries

Developer ID signing, notarisation, and Windows code signing would permit conventional downloads.
Until the required credentials, secure CI secrets, renewal process, and release ownership are in
place, the project will continue publishing source-only releases.

## Not planned

- **Cloud inference fallback:** the current product is designed around local models and explicit
  user-configured connectors.
- **Fine-tuning:** training workflows add substantial hardware, data, and support scope outside the
  application's current purpose.
- **Unbounded unattended agents:** scheduled jobs remain inference-only and cannot acquire tools or
  expand their own authority.
- **General-purpose system cleanup:** Repair remains limited to inspection and allowlisted app-owned
  data.
- **Additional Linux package formats:** formats beyond AppImage and Debian packages remain
  demand-driven.

## Proposing roadmap changes

Open a GitHub issue describing the user problem, target platforms, security and privacy effects,
dependencies, and a testable definition of done. A focused design document is preferred for changes
that introduce a new execution engine, trust boundary, data format, or network destination.

See [Contributing](../CONTRIBUTING.md) and the [documentation index](README.md).
