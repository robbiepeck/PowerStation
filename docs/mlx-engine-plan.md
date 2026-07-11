# MLX engine pack — design

**Status: designed, not built.** This document is the engineering plan for scope item #8. It is
deliberately a plan rather than a half-shipped feature: an MLX engine touches the model catalogue,
the download pipeline, the admission math, benchmarks and packaging, and shipping it partially
would break the app's core promise that what you see is what actually runs.

## Why MLX

Apple's [MLX](https://github.com/ml-explore/mlx) framework runs LLM inference 1.2–3× faster than
llama.cpp on Apple Silicon for many models, with especially strong prompt-processing speed. For a
Mac-first product whose differentiator is honest performance, offering the faster engine — with
measured, comparable numbers — is a natural chapter. LM Studio validated the pattern: multiple
engines behind one UI, selected per model.

## Why it is genuinely a big lift

1. **Different model format.** MLX does not run GGUF. Models are quantized safetensors from the
   `mlx-community` Hugging Face org. That means: a parallel catalogue (per-model MLX variants with
   their own sizes and revisions), a second download path, and double the catalogue-freshness
   surface.
2. **A Python runtime.** `mlx_lm.server` is Python. Shipping it means bundling a Python
   distribution (~100–200 MB) or managing a `uv`-created environment on first use — either way, a
   new packaging and update surface, macOS-only.
3. **A second chat path.** The worker currently speaks node-llama-cpp in-process. MLX would be an
   HTTP/stdio subprocess with its own streaming, tool-calling and session semantics; the host gains
   an engine abstraction and crash/recovery logic per engine.
4. **Admission control changes.** MLX has its own memory behaviour (unified-memory wired limits,
   different KV cache layout). The fit math needs per-engine cost models, or honesty regresses.
5. **Benchmarks must stay comparable.** The measured tok/s system needs per-engine records so a
   model card can say "llama.cpp: 34 tok/s · MLX: 51 tok/s" — that comparison is the whole point.

## Planned architecture

- **Engine registry** in the main process: `engine = 'llamacpp' | 'mlx'`, each implementing the
  same host interface (`load`, `chat`, `benchmark`, `deviceInfo`, crash events). The existing
  worker becomes the `llamacpp` engine unchanged.
- **MLX engine as a managed subprocess** (`mlx_lm.server`-compatible), spawned like MCP servers,
  speaking OpenAI-style streaming over localhost with per-request correlation.
- **Runtime acquisition on demand:** the engine pack is not in the base install. First use runs a
  guided download (bundled standalone Python + pinned `mlx-lm` wheelset, checksummed, from this
  repo's releases). Fully offline after that.
- **Catalogue:** each model entry gains an optional `mlx` variant block (repo, revision, size,
  quant). The recommender prefers MLX variants when the engine pack is installed and the measured
  benchmark says it is actually faster on this machine.
- **Benchmarks:** `benchmarks[fileOrRepo][engine] = {tokensPerSec, …}` and the comparison shown
  on the model card.

## Staging

1. **Prerequisite:** authenticated, integrity-checked pack delivery — a source-installed app must
   not download and execute an engine archive unless its provenance and digest are verified.
2. Engine registry refactor (no behaviour change; llama.cpp only).
3. MLX engine behind a "beta engines" setting, chat-only.
4. Catalogue MLX variants + per-engine benchmarks + recommender integration.
5. Tool calling on MLX, then default-on where measurably faster.

## Explicitly rejected shortcuts

- **A "use MLX" toggle that shells out to whatever Python happens to be installed** — works on a
  developer's machine, breaks everywhere else, and the failure lands on the app.
- **Recommending MLX models the runtime can't run yet** — the catalogue only ever lists what the
  installed engines actually execute.

*Related: [scope improvements](scope-improvements.md) item #8 · [architecture](architecture.md).*
