# PowerStation documentation

This documentation covers installation, day-to-day use, architecture, security, and contribution
workflows. PowerStation is beta software: macOS on Apple Silicon is the primary platform, while
Windows and Linux support remains beta.

## Start here

| Guide | Audience | Purpose |
| --- | --- | --- |
| [Quick start](quick-start.md) | New users | Install PowerStation and complete the first local chat. |
| [Source installation](source-install.md) | macOS users | Install, update, diagnose, and remove build artifacts safely. |
| [Release channels](releases.md) | Maintainers and users | Understand source-only Nightlies and signed stable releases. |
| [Setup](setup.md) | Contributors and beta users | Configure development environments, run from source, and package the app. |

## Features

| Guide | Purpose |
| --- | --- |
| [Models and devices](models-and-devices.md) | Supported hardware, catalogue models, imports, benchmarks, and model comparison. |
| [Agent harness](agent-harness.md) | Skills, MCP connectors, permissions, capability gating, audit logs, and loop guards. |
| [Projects and backup](projects.md) | Reusable workspace context and portable local backups. |
| [Agents](agents.md) | Reusable assistants with instructions, knowledge folders, and connector scope. |
| [Schedules](schedules.md) | Bounded, recurring local inference and run history. |
| [Local API server](api-server.md) | OpenAI-compatible localhost endpoints, authentication, and limitations. |
| [Repair](repair.md) | Storage inspection, model integrity checks, and conservative app-owned cleanup. |

## Internals and security

| Guide | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Process isolation, IPC, inference, retrieval, persistence, and scheduling. |
| [Memory and monitoring](memory-and-monitoring.md) | Admission-control calculations, runtime protection, and telemetry sources. |
| [Security policy](../SECURITY.md) | Private vulnerability reporting, supported versions, and security boundaries. |
| [Threat model](../THREAT_MODEL.md) | Assets, trust zones, threats, controls, and residual risks. |

## Project development

- [Contributing](../CONTRIBUTING.md) — development workflow, conventions, tests, and catalogue changes.
- [Changelog](../CHANGELOG.md) — notable user-facing changes by release.
- [Product roadmap](scope-improvements.md) — shipped capabilities, planned work, and explicit non-goals.
- [MLX engine proposal](mlx-engine-plan.md) — design for an optional Apple Silicon inference engine.
- [Vision support proposal](vision-plan.md) — current runtime blocker and implementation paths.

Documentation corrections are welcome. If instructions do not match the current application,
please [open an issue](https://github.com/robbiepeck/PowerStation/issues) or submit a focused pull
request.

[Back to the project README](../README.md)
