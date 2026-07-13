# Models and devices

This guide describes supported hardware, memory tiers, catalogue models, imported models, and
performance measurement. [`catalog/models.json`](../catalog/models.json) is the machine-readable
source of truth if the tables in this page fall out of date.

> [!NOTE]
> The current baseline is macOS on Apple Silicon (primary), Windows x64 (beta), or Linux x64
> (beta), with at least 16 GB memory. The catalogue contains 12 open-weight models across the
> 16 GB to 64 GB tiers.

---

## Supported devices

PowerStation's primary platform is **macOS on Apple Silicon (M-series)**, with **Windows 10/11
x64** and **Linux x64** supported in beta. On a Mac the CPU and GPU share one pool of **unified
memory**, so there is no separate VRAM number — what matters is how much of that pool the GPU may
use for a model.

- **Detected, never asked.** PowerStation reads your chip, total unified memory, the usable GPU
  budget (from the actual Metal backend that will run inference) and free disk on first launch.
- **Usable-for-AI budget.** Metal lets the GPU use roughly two-thirds to three-quarters of
  unified memory; PowerStation then leaves ~10% OS headroom on top. On a 24 GB Mac that lands
  around **~15 GB available for a model** — the number the fit math and the onboarding
  screen both quote.
- **16 GB floor.** Below 16 GB, PowerStation says plainly that local AI isn't realistic on the
  machine rather than hand you a model that will swap and beachball.

### Memory tiers

| Your Mac (unified memory) | Roughly usable for a model | What it comfortably runs |
| --- | --- | --- |
| **8 GB** | — | Below the floor. PowerStation recommends a bigger machine. |
| **16 GB** | ~10–11 GB | Fast 4–8B models, and 20B mixture-of-experts models with a modest context. Great chat and light agents. |
| **24 GB** | ~15–16 GB | 24–31B-class models (dense and MoE). Real coding and agent sessions with a moderate context. |
| **32 GB** | ~21–22 GB | 30–35B MoE models at a comfortable context — the sweet spot for agents and coding. |
| **64 GB+** | ~40–46 GB | 80B MoE and 120B models — the strongest local options short of a workstation. |

Apple Silicon can run models larger than the dedicated VRAM available on many consumer GPUs because
its unified memory is shared by the CPU and GPU.

### Windows and Linux PCs (beta)

On Windows and Linux the picture splits in two:

- **Discrete GPU (NVIDIA/AMD).** The fast budget is your **VRAM**, measured from the CUDA/Vulkan
  backend that will actually run inference. Before the runtime has reported backend memory,
  PowerStation also reads the OS GPU inventory and prefers the largest discrete NVIDIA/AMD adapter,
  so multi-GPU laptops do not get judged by the integrated GPU. Models that fit entirely in VRAM
  run at full speed.
  Models larger than VRAM but within ~80% of your system RAM still run — llama.cpp offloads the
  overflow layers to the CPU — and PowerStation marks these as **"Runs on CPU · slower"**
  rather than pretending they're fast or blocking them outright.
- **No discrete GPU.** Inference runs on the CPU out of system RAM. Everything works, but expect a
  fraction of the speeds listed below; stick to the smaller models.

The same 16 GB system-RAM floor applies. Rough guidance: 16 GB RAM + 8 GB VRAM handles the 16 GB
tier at full speed and the 24 GB tier via offload; 32 GB RAM + 12–16 GB VRAM makes the 24–32 GB
tiers practical. The per-model notes below are written for Apple Silicon's
unified memory — on Windows/Linux, trust the app's live fit badges, which are computed from your
actual measured VRAM and RAM.

### PC VRAM tiers

Treat VRAM as the fast lane, and system RAM as the slower safety net for CPU offload:

| GPU VRAM | Fast-path guidance |
| --- | --- |
| **4–6 GB** | Small 4–8B models. Larger models usually run mostly on CPU and feel much slower. |
| **8 GB** | Good for compact 4–8B models at full speed; 20B-class models are usually tight or offloaded. |
| **12 GB** | Practical for the 16 GB catalogue tier and some 20B-class models with modest context. |
| **16 GB** | Strong Windows/Linux sweet spot: 20B-class models and some 24B-class models without heavy offload. |
| **24 GB+** | Comfortable for many 24–32 GB catalogue-tier models, with enough room for longer contexts. |

The app's fit badge is still the authority because it includes the exact GGUF size, KV-cache cost,
context setting, and the backend-reported memory when available.

### Performance guidance

The tokens-per-second figures below are rough expectations for a mid-tier M4-class Mac. Bandwidth
is the bottleneck for local inference, so a higher-bandwidth chip (M-series Pro/Max) runs the same
model noticeably faster, and each doubling of the context window costs roughly 10–20% speed.
Mixture-of-experts models (only a few billion parameters "active" per token) feel much faster than
their total size suggests.

---

## The model catalogue

All 12 models are quantized GGUFs, verified to exist on Hugging Face. **Tools** is the capability
tier PowerStation gates agent features on:

- **multi** — trained for multi-step agent loops; gets the full harness (up to 15 tool calls/turn).
- **single** — reliable single/parallel tool calls; capped at 3 tool calls/turn.
- **chat** — not tool-trained; chat only, with the reason stated in the app.

### 16 GB tier

| Model | Family | Params (total / active) | Quant | Download | Tools | Licence | ~Speed |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| **Qwen3.5 4B** | Qwen3.5 | 4B (dense) | Q4_K_M | 2.7 GB | multi | Apache-2.0 | 30–50 tok/s |
| **Gemma 4 E4B** | Gemma 4 (Google) | 8B / 4B | Q4_K_M | 5.3 GB | single | Apache-2.0 | 40–60 tok/s |
| **gpt-oss 20B** | gpt-oss (OpenAI) | 21B / 3.6B | MXFP4 | 12.1 GB | multi | Apache-2.0 | 50–70 tok/s |

- **Qwen3.5 4B** — fast, reliable tool calling for its size and a tiny memory footprint at long
  context. Great everyday assistant and light agent. *Struggles with:* deep specialist knowledge,
  large multi-file coding.
- **Gemma 4 E4B** — strong multilingual chat (140+ languages) and long-document reading.
  *Struggles with:* hard math/coding and long multi-step agent tasks (fine for single tool calls).
- **gpt-oss 20B** — step-by-step reasoning with adjustable effort and solid agent tool use; only
  3.6B of 21B active per token. *Struggles with:* a tight fit on 16 GB (keep the context modest);
  thinner world knowledge.

### 24 GB tier

| Model | Family | Params (total / active) | Quant | Download | Tools | Licence | ~Speed |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| **Devstral Small 2 24B** | Mistral / Devstral | 24B (dense) | Q4_K_M | 14.3 GB | multi | Apache-2.0 | 12–18 tok/s |
| **Gemma 4 26B-A4B** | Gemma 4 (Google) | 25.2B / 3.8B | Q4_K_M | 16.8 GB | multi | Apache-2.0 | 25–45 tok/s |
| **GLM-4.7 Flash** | GLM (Z.ai) | 31.2B / 3B | Q4_K_M | 18.1 GB | multi | MIT | 40–60 tok/s |
| **Qwen3 Coder 30B-A3B** | Qwen3-Coder | 30.5B / 3.3B | Q4_K_M | 18.6 GB | multi | Apache-2.0 | 40–60 tok/s |

- **Devstral Small 2 24B** — agentic coding specialist: explores a codebase, edits files and drives
  tools in a loop. Dense, so slower per token; 32 GB is recommended for large contexts.
- **Gemma 4 26B-A4B** — strong general chat and reasoning with only 4B active. Tight on 24 GB;
  32 GB is comfortable.
- **GLM-4.7 Flash** — strong multi-step agent loops and coding for its size, MIT-licensed and
  memory-efficient. Text only.
- **Qwen3 Coder 30B-A3B** — strong agentic coding across many languages with very long context.
  No thinking mode, so weaker at deep math.

### 32 GB tier

| Model | Family | Params (total / active) | Quant | Download | Tools | Licence | ~Speed |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| **Qwen3.6 35B-A3B** | Qwen3.6 | 35B / 3B | Q4_K_M | 21.2 GB | multi | Apache-2.0 | 35–55 tok/s |
| **Nemotron 3 Nano 30B-A3B** | Nemotron (NVIDIA) | 30B / 3.5B | Q4_K_M | 24.7 GB | multi | NVIDIA Open Model License | 45–60 tok/s |

- **Qwen3.6 35B-A3B** — flagship-quality agentic coding and multi-step tool use that fits a 32 GB
  Mac, fast thanks to 3B active per token, 256K context with a tiny footprint.
- **Nemotron 3 Nano 30B-A3B** — reasoning model with visible thinking and a controllable thinking
  budget, strong at math/coding with tools. Thinks by default, which slows simple requests.

### 64 GB+ tier

| Model | Family | Params (total / active) | Quant | Download | Tools | Licence | ~Speed |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| **Qwen3 Coder Next 80B-A3B** | Qwen3-Next | 80B / 3B | Q4_K_M | 48.4 GB | multi | Apache-2.0 | 20–30 tok/s |
| **Qwen3 Next 80B-A3B** | Qwen3-Next | 80B / 3B | Q4_K_M | 48.4 GB | multi | Apache-2.0 | 20–30 tok/s |
| **gpt-oss 120B** | gpt-oss (OpenAI) | 117B / 5.1B | MXFP4 | 63.4 GB | multi | Apache-2.0 | 30–45 tok/s |

- **Qwen3 Coder Next 80B-A3B** — agentic coding with reliable multi-step tool calling and error
  recovery over very large codebases.
- **Qwen3 Next 80B-A3B** — big-model chat quality with small-model speed and strong multilingual
  coverage.
- **gpt-oss 120B** — the strongest local option short of a workstation: complex reasoning and
  reliable multi-turn agent loops. Barely fits 64 GB, so it leaves little room for other apps.

> Some larger models ship as **multi-part GGUFs** (e.g. gpt-oss 120B in 3 parts). PowerStation's
> admission control sums all parts, so a split model can't sneak past the fit check by looking
> like just its first shard.

---

## How the catalogue stays current

The model landscape turns over every few months, so the catalogue is **not** baked into the app
binary:

1. `catalog/models.json` in this repository is the source of truth. A bundled copy ships with the app
   as an offline fallback.
2. On launch, the app fetches the latest `models.json` from the repository. The **Update catalog** button
   in the Models view re-fetches on demand.
3. Remote catalogue data is treated as untrusted: every field is validated and download URLs are
   pinned to `huggingface.co` before anything reaches the UI.

Each entry carries machine-readable fields the recommender and the memory math consume — file size,
KV-cache geometry, effective bytes-per-token for hybrid-attention models, tool-calling tier, licence,
minimum RAM and capability notes. To propose a model, see [Contributing](../CONTRIBUTING.md).

## Bring your own model

Not limited to the catalogue — import any `.gguf` file or point PowerStation at a folder of models
from the **Models** tab. Imported models still get admission control (sized from the GGUF header),
and their tool-calling tier is inferred from the embedded chat template. You are responsible for
reviewing and complying with each model's licence.

**Removing a model.** Each model in the Models view has a **Delete** button that permanently
removes it from disk to free up space (multi-part models delete every part; the currently-loaded
model is unloaded first). For an *imported* file you can instead **Remove** it — that only
unregisters it from PowerStation and leaves the file where it is.

**Already using Ollama or LM Studio?** PowerStation detects models both apps have on disk and
registers them **in place** with one click — no re-download, no extra disk. They run in
PowerStation's own runtime with the same admission checks as any other model (split GGUF series
are priced as the whole set).

## Choosing between models

PowerStation provides three ways to compare models on the current computer:

- **Benchmarks** — one click per model measures real write speed *and* prompt-ingestion (read)
  speed on your exact machine; results appear on every card and recommendation.
- **Compare two models** — one prompt, both models, side by side with write speed, first-token
  latency, and total time. Runs are sequential by design (one model in memory at a time), so each
  candidate gets the whole machine — fair timings, no memory gamble.
- **"Why this over that"** — every alternate recommendation explains itself against the top pick
  on the axes that differ: fit, measured or likely speed, knowledge capacity, and tool-calling
  strength, including cases where the alternate is stronger on a particular axis.
