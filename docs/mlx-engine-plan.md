# MLX engine proposal

- **Status:** Design proposal; not implemented
- **Target platform:** macOS on Apple Silicon
- **Last reviewed:** 6 July 2026

This proposal describes an optional MLX inference engine for PowerStation. It is intentionally not
represented as a committed release. An additional engine affects model distribution, admission
control, benchmarking, process isolation, packaging, and support expectations; those components must
be designed together.

## Motivation

[MLX](https://github.com/ml-explore/mlx) is an Apple Silicon machine-learning framework. For some
model architectures and workloads, MLX can provide higher generation or prompt-processing throughput
than llama.cpp. Supporting it could improve local performance while preserving PowerStation's
hardware-aware model selection and measurement-based recommendations.

The feature is valuable only if users can compare engines using measurements from their own machine
and if the same safety and reliability standards apply to both.

## Design constraints

### Model format

MLX uses quantised safetensor repositories rather than GGUF files. The catalogue would need optional
MLX variants with independent repository revisions, sizes, quantisation metadata, licences, and
freshness checks.

### Runtime distribution

The likely serving path depends on Python and `mlx-lm`. PowerStation would need either a bundled,
pinned runtime or a managed environment installed on demand. Relying on an arbitrary system Python
would create inconsistent behaviour and an unsupported dependency surface.

### Engine abstraction

The current inference worker uses `node-llama-cpp` directly. MLX would require a common host
interface for loading, generation, streaming, benchmarks, device reporting, cancellation, and crash
recovery. The user-facing application should not duplicate chat logic for each engine.

### Admission control

MLX has different memory allocation and KV-cache behaviour. Its fit decisions require engine-specific
measurements or validated cost models. Reusing llama.cpp estimates without evidence would undermine
the application's admission-control guarantees.

### Comparable benchmarks

Benchmark records must include the engine so that equivalent model variants can be compared without
overwriting one another. Recommendation logic should prefer an engine only when compatibility and
measured performance support the choice.

## Proposed architecture

Introduce an engine registry in the Electron main process:

```ts
type Engine = {
  load(request: LoadRequest): Promise<LoadResult>;
  chat(request: ChatRequest): AsyncIterable<ChatEvent>;
  benchmark(request: BenchmarkRequest): Promise<BenchmarkResult>;
  deviceInfo(): Promise<DeviceInfo>;
  stop(): Promise<void>;
};
```

The existing utility-process implementation becomes the `llamacpp` engine without changing its
external behaviour. An `mlx` implementation runs as a managed subprocess and exposes correlated,
streaming requests over loopback HTTP or stdio.

The runtime pack would be installed on demand rather than included in the base application. It must
have pinned versions, cryptographic digests, a documented update path, and an offline operating mode
after installation.

Catalogue entries would gain an optional variant similar to:

```json
{
  "mlx": {
    "repository": "publisher/model-mlx",
    "revision": "pinned-revision",
    "sizeBytes": 0,
    "quantization": "4-bit"
  }
}
```

The exact schema remains subject to implementation review.

## Delivery stages

1. Define authenticated, integrity-checked runtime-pack distribution.
2. Introduce the engine interface with llama.cpp as the only implementation.
3. Add an opt-in MLX engine for chat-only workloads.
4. Add MLX catalogue variants, engine-specific fit data, and benchmark records.
5. Integrate measured engine selection into recommendations and comparisons.
6. Add tool calling only after streaming, cancellation, isolation, and prompt formats are reliable.

Each stage should preserve current llama.cpp behaviour and include a rollback path.

## Acceptance criteria

- Runtime acquisition verifies provenance and integrity before execution.
- Uninstalling the optional pack removes its runtime without affecting GGUF models or user data.
- Fit decisions are backed by validated MLX memory measurements.
- Benchmarks distinguish model variant, engine, and device.
- Engine failures surface through the same recovery experience as llama.cpp failures.
- Chat, API, comparison, and scheduled work remain serialised correctly across engines.
- Tool capability gating is no less strict than the existing harness.
- Packaging and CI exercise installation, upgrade, removal, and offline reuse.

## Rejected approaches

- Shelling out to whichever Python environment happens to be installed.
- Displaying MLX model variants before an installed engine can execute them.
- Selecting MLX by default without compatibility checks and device-specific measurement.
- Sharing llama.cpp memory estimates without MLX validation.

## Open questions

- Should runtime packs be published as GitHub Release assets or built locally from locked sources?
- Is loopback HTTP or stdio the more robust transport for cancellation and streaming?
- Which MLX memory signals are stable enough for admission control?
- How should equivalent GGUF and MLX model variants share user-facing identity and storage controls?

See the [product roadmap](scope-improvements.md), [Architecture](architecture.md), and
[Memory and monitoring](memory-and-monitoring.md).
