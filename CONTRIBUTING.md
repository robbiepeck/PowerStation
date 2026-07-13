# Contributing to PowerStation

Thank you for helping improve PowerStation. Contributions are welcome across the application,
documentation, tests, model catalogue, and connector catalogue.

## Before you begin

- Use [GitHub Issues](https://github.com/robbiepeck/PowerStation/issues) to report reproducible bugs
  or propose substantial changes.
- Report vulnerabilities privately by following [Security](SECURITY.md). Do not open a public issue
  for a suspected security problem.
- Keep pull requests focused. Unrelated changes are easier to review when submitted separately.
- Confirm that a dependency or catalogue addition has a compatible licence and a clear maintenance
  purpose.

## Development environment

Requirements:

- Node.js 22 or newer and npm;
- macOS on Apple Silicon, Windows 10/11 x64, or Linux x64;
- at least 16 GB system memory;
- Xcode Command Line Tools on macOS when a native dependency must build from source.

Set up a development checkout:

```bash
git clone https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm ci
npm run desktop:dev
```

The [setup guide](docs/setup.md) contains platform notes, packaging commands, and troubleshooting.

## Repository structure

| Path | Purpose |
| --- | --- |
| `electron/` | Electron main process, inference worker, IPC, persistence, and operating-system integrations. |
| `src/` | Sandboxed React renderer and shared renderer types. |
| `catalog/` | Validated model, connector, and skill catalogues. |
| `skills/` | Bundled skill definitions seeded into user data. |
| `scripts/` | Development, installation, diagnostics, packaging, and smoke-test helpers. |
| `docs/` | User, architecture, feature, and roadmap documentation. |
| `.github/workflows/` | CI and catalogue-freshness automation. |

For process boundaries and data flow, see [Architecture](docs/architecture.md).

## Making a change

1. Create a branch from `main`.
2. Make the smallest coherent change that solves the problem.
3. Add or update tests for observable behaviour.
4. Update relevant documentation and changelog entries when user-facing behaviour changes.
5. Run the required checks.
6. Open a pull request that explains the motivation, behaviour change, risks, and validation.

### Required checks

```bash
npm run build
npm run lint
npm test
```

Run `npm run desktop:dev` and exercise the affected workflow when changing the UI, Electron IPC,
model loading, permissions, persistence, or packaging. Platform-specific packaging changes should
also be tested on the target operating system where possible.

## Engineering conventions

- Keep TypeScript strict and avoid `any` when the type can be expressed.
- Follow the naming, formatting, and module structure of the surrounding code.
- Write comments for constraints and design intent, not as a restatement of the next line.
- Keep the renderer sandboxed. New filesystem, process, or network capabilities must be exposed
  through narrow, typed preload and IPC interfaces.
- Treat catalogues, model metadata, tool output, imported files, and restored backups as untrusted.
- Preserve the local-first design. New network behaviour must be explicit, documented, and scoped.
- Keep security-sensitive parsing and policy decisions in pure functions where practical, with tests
  for malformed input and boundary conditions.
- Avoid logging prompts, attachment contents, credentials, tokens, or user file paths.

## Catalogue contributions

The catalogue is application data and is validated independently of the application build. A model
entry in `catalog/models.json` must include accurate download metadata, memory characteristics,
capability notes, tool-use tier, and licence information.

When proposing a model:

1. Use an official or well-established Hugging Face repository.
2. Pin the exact GGUF filename and URL; include every shard for split models.
3. Verify download sizes and any vision projector metadata.
4. Provide KV-cache geometry or a defensible measured bytes-per-token value.
5. Assign the catalogue tool tier conservatively: `multi`, `single`, or `none`.
6. Write specific strengths and limitations without benchmark hype.
7. Confirm the model licence permits the intended distribution and use.

Run the relevant checks after editing a catalogue:

```bash
node scripts/check-catalog-freshness.mjs
npm test
```

Catalogue freshness is also checked by GitHub Actions on relevant changes and on a schedule.

## Pull request expectations

A useful pull request description includes:

- the problem or opportunity;
- the chosen approach and important trade-offs;
- user-visible and compatibility effects;
- security, privacy, or performance considerations;
- the checks and manual workflows used for validation.

Maintainers may request a narrower scope, additional tests, or documentation before merging. By
contributing, you agree that your work will be licensed under the repository's [MIT License](LICENSE).
