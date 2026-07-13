# Vision input proposal

- **Status:** Runtime-blocked; catalogue groundwork implemented
- **Last reviewed:** 6 July 2026

PowerStation does not currently accept image input. This document records the implemented groundwork,
the current runtime limitation, and the supported implementation paths. Vision controls should not
appear in the product until the packaged inference runtime can process them reliably.

## Current limitation

The catalogue includes Gemma model variants with verified multimodal projector files, but
`node-llama-cpp@3.19.0` does not expose the required multimodal API for these models. Its public chat
types are text-only, it provides no projector-loading option, and its packaged dependencies do not
include a `llama-server` executable that PowerStation can manage as a fallback.

Although upstream llama.cpp supports these models through `libmtmd`, that capability is not currently
available through PowerStation's installed Node.js binding. Consequently, the application does not
show an image picker, download projector files, or advertise image inference as available.

## Implemented groundwork

### Catalogue metadata

The model schema supports an optional vision block containing projector URL, filename, and size.
Remote values pass the same host validation as model downloads. Catalogue cards may identify a model
as vision-capable while clearly stating that image input is not yet supported by PowerStation.

### Freshness checks

Scheduled catalogue validation verifies projector URLs and sizes. A dependency watchdog also reports
new `node-llama-cpp` releases so multimodal support can be re-evaluated promptly.

### Attachment architecture

The existing attachment system already handles file selection, drag-and-drop, persistence, and replay.
Images can be introduced as another validated attachment kind without redesigning chat persistence.

## Preferred implementation: upstream Node.js support

When `node-llama-cpp` exposes projector loading and image prompt content for the relevant model
families, the implementation should include:

- loading the projector alongside the selected model in the inference worker;
- extending the worker protocol with validated image attachments;
- downloading the projector next to managed model files;
- including projector allocation and image token cost in admission control;
- enabling image selection only for models with a compatible installed projector;
- rendering bounded thumbnails and persisted image attachments in chat;
- tests for unsupported formats, missing projectors, corrupted files, cancellation, and replay.

This path preserves the existing isolated worker and avoids introducing a second inference transport.

## Alternative implementation: managed server engine

A managed `llama-server` subprocess could expose multimodal inference through an OpenAI-compatible
loopback interface. This requires per-platform binary distribution, integrity verification, process
lifecycle management, streaming correlation, cancellation, admission control, and crash recovery.

The work overlaps with the engine registry described in the [MLX proposal](mlx-engine-plan.md). If
that abstraction is implemented first, a server-backed multimodal engine becomes more practical.

## Acceptance criteria

- Image controls appear only when the selected model, projector, and engine are compatible.
- Projector and image memory costs are included in the pre-load fit decision.
- Images remain local except when a user explicitly sends them through a configured network tool.
- Supported formats, dimensions, and file sizes are validated before reaching the native runtime.
- Chat persistence and export clearly represent image attachments without embedding unsafe content.
- Worker crashes remain isolated and recoverable.
- Catalogue claims and UI labels distinguish model capability from currently available runtime support.

## Rejected approaches

- Shipping a non-functional image picker before the runtime supports image prompts.
- Downloading approximately one gigabyte of projector data before the feature can run.
- Routing images through a user-installed Ollama or llama.cpp process while text uses PowerStation's
  managed runtime, which would create inconsistent admission control and support behaviour.

## Re-evaluation trigger

Revisit this proposal when the packaged `node-llama-cpp` version exposes multimodal projector loading
and typed image messages, or when PowerStation gains a validated multi-engine abstraction.

See the [product roadmap](scope-improvements.md), [Architecture](architecture.md), and
[threat model](../THREAT_MODEL.md).
