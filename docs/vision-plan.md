# Vision (image input) — status and plan

**Status: blocked on the runtime, groundwork shipped.** This page records what was verified, what
is already in place, and exactly what remains — so vision ships the week the blocker lifts, not a
quarter later.

## What was verified (2026-07-06)

- **The models are real.** Both Gemma 4 entries in the catalogue have genuine vision projector
  files on Hugging Face, verified by size:
  - `gemma-4-E4B` — `mmproj-gemma-4-E4B-it-BF16.gguf` (991 MB)
  - `gemma-4-26B-A4B` — `mmproj-gemma-4-26B-A4B-it-BF16.gguf` (1.19 GB)
- **The runtime cannot run them.** `node-llama-cpp@3.19.0` — the latest release — exposes **no
  multimodal API**: `ChatUserMessage` is text-only, there are no mmproj load options, and nothing
  image-related exists anywhere in its type surface. llama.cpp itself supports these models (via
  `libmtmd`), but the Node bindings don't expose it, and the binding packages ship only library
  binaries — no `llama-server` executable to shell out to.

Per this project's standing rule (see the [MLX plan](mlx-engine-plan.md)): the app never ships a
feature the installed runtime can't actually execute. So there is no image picker, no mmproj
download, and no vision toggle in the app today — only honest metadata.

## What is already in place (shipped as groundwork)

1. **Catalogue schema + verified data** — `CatalogModel.vision { mmprojUrl, mmprojFileName,
   mmprojSizeBytes }`, sanitized with the same huggingface.co pinning as model downloads, populated
   for the two Gemma entries. Catalogue cards show a neutral *vision-capable model* badge with a
   tooltip stating plainly that PowerStation doesn't run images yet.
2. **Freshness CI covers vision files** — mmproj URLs and sizes are re-verified weekly alongside
   everything else, and a **runtime watchdog** warns whenever a newer `node-llama-cpp` ships, so
   the unblock gets evaluated immediately.
3. **The attachment pipeline** (v0.5) already handles picking, drag-and-drop, per-chat persistence
   and replay — images slot in as a new attachment kind rather than a new system.

## The two viable paths

**Path A — upstream multimodal in node-llama-cpp (preferred).** When the bindings expose mmproj
loading and image content in prompts, the work remaining here is small and local:

- Worker: load the mmproj alongside the model (`ensureModelLoaded` gains a projector path);
  accept `images` in `ChatRequest` and pass them into the prompt.
- Downloads: fetch the mmproj next to the model file (URL and size already in the catalogue);
  admission control adds `mmprojSizeBytes` to the weights term and an estimated per-image token
  cost to the context term.
- Renderer: enable image files in the existing attachment picker/drop (gated on the selected
  model's `vision` field), thumbnail chips, image display in the user bubble.

**Path B — engine registry + `llama-server` subprocess.** Ship llama.cpp's server binary as a
managed engine (OpenAI-style multimodal API over localhost). Viable but heavy: per-platform binary
distribution, a second chat path, and its own crash/recovery handling. This is the same
architecture as the [MLX engine pack](mlx-engine-plan.md) — if the engine registry gets built for
MLX, vision-by-server comes nearly free, and vice versa.

## Explicitly rejected

- A vision UI that appears before the runtime works.
- Downloading mmproj files "in advance" — a gigabyte of disk for a feature that can't run.
- Shelling out to a user-installed llama.cpp/Ollama for images only — split-brain inference with
  inconsistent admission control (and Ollama import users would reasonably expect parity).

*Related: [scope improvements](scope-improvements.md) · [MLX plan](mlx-engine-plan.md).*
