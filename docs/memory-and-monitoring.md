# Memory & monitoring

PowerStation's promise is that it won't let a model take your Mac down, and that the numbers it shows
you are honest. This is how both work.

## Admission control: decide before you load

The wrong way to protect a machine is to show a RAM graph and hope the user hits "kill" before it
swaps. By the time a graph looks alarming, macOS is already thrashing. PowerStation instead does the
math **before** loading, because every input is knowable up front.

For a given model and context length, the memory needed is:

```
total ≈ weights + KV-cache(context) + compute buffers
```

- **weights** ≈ the GGUF file size (memory-mapped). Multi-part models sum all shards.
- **KV-cache** grows linearly with context length. For a plain transformer it's
  `2 × layers × kv_heads × head_dim × tokens × 2 bytes`. Many 2026 models use **hybrid attention**
  (sliding-window or linear layers) where the real cost is far below that naive formula, so the
  catalogue carries a measured **bytes-per-token** value that overrides it.
- **compute buffers** — a floor plus a fraction of the weights.

This total is compared against your **usable budget** — the accelerator memory the backend that
will run inference actually reports (the Metal working-set limit on Apple Silicon; discrete VRAM
under CUDA/Vulkan on Windows) — minus ~10% OS headroom.

The result is one of three verdicts:

- **Comfortable** — loads as requested.
- **Tight** — loads, but with a caveat the UI states plainly. Two flavours: the context is capped
  to fit the GPU budget, or — when the model exceeds the GPU budget but fits within ~80% of system
  RAM — it runs with layers **offloaded to the CPU**, which works but is much slower.
- **Won't fit** — refused with an explanation, before anything is loaded.

When a load doesn't fit comfortably, admission control walks a **degradation ladder** — shrink the
context to what fits, and only refuse when even a minimal context won't. The math lives in
[`electron/admission.ts`](../electron/admission.ts) and is covered by unit tests
([`electron/admission.test.ts`](../electron/admission.test.ts)) that check it against known
real-world figures (for example, ~128 KB/token and ~4 GB of KV cache at 32K context for an 8B model).

## Runtime protection: memory-pressure auto-pause

Admission control handles the load; the memory-pressure signal handles the session. On macOS the
kernel exposes a memory-pressure level without any elevated privileges; on Windows there is no single
kernel pressure number without a driver, so PowerStation derives the level from available physical
memory and labels it as derived. PowerStation samples it in the
telemetry loop, and on the transition into **critical** pressure it **auto-pauses generation** and
offers a one-tap choice — free up memory, switch to a smaller model, or continue anyway. The pause
latches on the transition, so a sustained episode fires once, not once per telemetry tick.

Crashes are contained too: inference runs in a separate process, so a native out-of-memory crash
yields a **recovery card** rather than a dead app, with an escalating cooldown that prevents a
crash-on-load model from being re-spawned in a tight loop.

## Honest telemetry

The Monitor tab shows live signals, and PowerStation is careful to label what's **measured** versus
**estimated** — because a monitoring tool that dresses up guesses as facts undermines the trust it's
trying to build.

| Signal | Source |
| --- | --- |
| CPU load, RAM used/total | Measured (live). |
| GPU-usable memory (VRAM budget) | Measured from the inference backend. |
| Storage used/free | Measured. |
| **Memory pressure** | macOS: measured kernel signal, no privileges needed. Windows: derived from available memory (labelled as such). |
| Tokens per second | Measured during generation. |
| GPU utilisation | Not available without elevated access on macOS — shown as n/a. |
| **Power draw (watts)** | **Estimated** — real wattage isn't readable on macOS without elevated access, so this is a labelled estimate derived from load, never presented as a sensor reading. |
| **Battery** | Measured (percentage and charging state). |
| Thermal headroom | Sensor where available, otherwise estimated (labelled). |

Two battery-aware touches follow the same honesty rules: below 25% on battery the status pill
suggests a lighter model (smaller models draw less power), and the chat header shows an **estimated
watt-hours figure** for the session's generation — explicitly a ballpark, because it's built on the
estimated power draw, and labelled as such.

The everyday surface isn't this dashboard, though — it's the **status pill** in the chat header:
*Running smoothly · N tok/s*, amber *Memory getting tight*, or red *Memory critical*. The full Monitor
is a click away for when you want the detail. The goal is that your job is a decision, never a
diagnosis.

## Where to look in the code

- `electron/admission.ts` — the fit math and the degradation ladder.
- `electron/hardware.ts` — hardware detection and the memory-pressure read.
- `electron/telemetry.ts` — the sampling loop and the measured/estimated flags.
- `electron/main.ts` — the auto-pause on critical pressure.

See [Architecture](architecture.md) for how these fit into the whole, and
[Models & devices](models-and-devices.md) for how the budget maps to real machines.
