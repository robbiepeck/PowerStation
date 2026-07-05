# Contributing to PowerStation

Thanks for your interest. PowerStation is MIT-licensed and contributions are welcome — code, docs,
and especially keeping the model catalogue current.

## Development setup

See the [Setup Guide](docs/setup.md) for full detail. In short:

```bash
git clone https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm install
npm run desktop:dev
```

Requirements: macOS on Apple Silicon or Windows 10/11 x64 (16 GB+), Node.js 20+; on macOS the
Xcode Command Line Tools. CI runs lint, tests and builds on both platforms for every PR.

## Before you open a PR

Run the full check locally — CI expects all of these green:

```bash
npm run build   # typecheck + build renderer and electron
npm run lint    # eslint
npm test        # unit tests
```

If your change touches the app UI, also run it (`npm run desktop:dev`) and confirm the flow works
end to end.

## Project layout

A quick orientation; the [Architecture](docs/architecture.md) guide goes deeper.

- `electron/` — main process, the isolated inference worker, and the message protocol between them.
- `src/` — the React renderer (chat, onboarding, models, monitor, utilities, settings).
- `catalog/models.json` — the model catalogue (data, not code — see below).
- `docs/` — these guides.

## Coding conventions

- **TypeScript, strict.** No `any` escapes where a real type is knowable.
- **Match the surrounding style.** Comment density, naming and idiom should look like the file you're
  editing. Comments explain *why* / constraints, not *what* the next line does.
- **The trust boundary is real.** The renderer never gets direct Node/filesystem access — new
  capabilities go through a typed IPC channel in `electron/ipc.ts`, the preload allowlist
  (`electron/preload.cjs`), and the `PowerStationBridge` type in `src/types.ts`. All three must agree.
- **Treat external input as untrusted.** Remote catalogue data, model files, and MCP tool output are
  validated/capped and never executed.
- **One home for each rule.** Prefer resolving a fact once in the main process over re-deriving it in
  the renderer.

## Proposing a model for the catalogue

The catalogue is the product's editorial heart, and it goes stale fast — model additions are among the
most valuable contributions. Add an entry to [`catalog/models.json`](catalog/models.json) with all
fields populated and **verified**:

- `downloadUrl` / `websiteUrl` must be on `huggingface.co` and return 200/302 (the app pins to that
  host). `fileName` and `sizeBytes` must match the actual GGUF (for multi-part models, point at part
  `00001`).
- `geometry` (`nLayers`, `nKvHeads`, `headDim`) and, for hybrid-attention models, `kvBytesPerToken`
  — these feed admission control. Getting KV cost wrong makes the fit check lie.
- `toolCalling` — `multi` / `single` / `none`, based on the model's documented tool training (not a
  guess).
- `minRamGb` (16 / 24 / 32 / 64), `license`, `expectedTps`, `useCases`, and honest `goodAt` /
  `strugglesWith` notes.

Bump `updatedAt`. See [Models & devices](docs/models-and-devices.md) for the current set and the
verification bar. In your PR, note how you verified the URL and the geometry.

## Commits and PRs

- Keep commits focused and messages descriptive.
- Reference any issue the PR addresses.
- Describe what you changed, why, and how you tested it.

## Reporting bugs and security issues

- **Bugs / features:** open a GitHub issue with steps to reproduce and your macOS + chip + memory.
- **Security:** please don't file a public issue — see [SECURITY.md](SECURITY.md).
