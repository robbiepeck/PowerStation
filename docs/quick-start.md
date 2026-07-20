# Quick start

This guide takes a new user from a stable source checkout to the first local conversation.

## Requirements

- macOS on Apple Silicon with at least 16 GB unified memory; or Windows 10/11 x64 or Linux x64
  with at least 16 GB RAM;
- Node.js 22 or newer and npm;
- approximately 4 GB of temporary free storage for the application build, plus storage for models;
- Xcode Command Line Tools on macOS.

macOS is the primary supported platform. Windows and Linux support is beta, and a discrete GPU with
at least 8 GB VRAM is recommended on those platforms.

## Install on macOS

Nightly prereleases are source-only. The supported macOS source installer builds and ad-hoc signs
the application on the destination computer. When a signed stable macOS package is published, its
packaged app can update itself directly instead.

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm run doctor
npm run install:mac
```

`npm run install:mac` installs the locked dependencies, builds the application, verifies the local
signature, installs it into `/Applications` or `~/Applications`, and opens it. Existing PowerStation
models, chats, and settings are preserved.

For update commands, data-preservation details, and diagnostics, use the
[source installation guide](source-install.md).
See [Release channels](releases.md) for the distinction between Nightly and stable releases.

## Run on Windows or Linux

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm ci
npm run desktop:dev
```

Keep the terminal open while PowerStation is running. Review [Setup](setup.md) for platform-specific
prerequisites and limitations.

## Complete first-run setup

1. Review the detected processor, memory, accelerator budget, and free storage.
2. Select the primary workload: everyday use, coding, agents, documents, or reasoning.
3. Choose whether to prioritise faster responses or stronger model capability.
4. Review up to three recommendations. Each card explains memory fit, expected performance,
   strengths, and limitations.
5. Select **Download & set up**. PowerStation downloads the model into its managed data directory,
   loads it, and opens a new chat.

The **Models** view can also import existing GGUF models or models already managed by Ollama or
LM Studio. Imported models still pass admission control before loading.

## Try local retrieval

From the chat composer, attach a supported text, code, Markdown, or PDF file. To search across a
directory, attach a folder. PowerStation creates a local embedding index and cites retrieved source
files in its answers. The embedding model is downloaded once and used locally afterward.

## Configure tools (optional)

Tool-trained models can use MCP connectors. Open **Utilities**, choose a connector from the gallery,
or add a custom server such as:

```text
npx -y @modelcontextprotocol/server-filesystem ~/Documents
```

New tools ask for permission by default. Review the server, tool name, arguments, and any file diff
before choosing **Allow once**, **Allow rest of turn**, **Always allow**, or **Deny**. Custom MCP
servers run with your operating-system permissions; install only servers you trust.

See [Agent harness](agent-harness.md) for capability tiers, permission profiles, and audit logs.

## Monitor resource use

The status indicator in the chat header reports current generation speed and warns when memory or
battery conditions change. Open **Monitor** for CPU, memory, accelerator capacity, storage, pressure,
battery, power, and thermal data. Values that are inferred rather than read from a sensor are labelled
as estimated or derived.

## Next steps

- Create a reusable workspace with [Projects](projects.md).
- Configure a reusable assistant with [Agents](agents.md).
- Compare installed models using [Models and devices](models-and-devices.md).
- Run bounded recurring prompts with [Schedules](schedules.md).
- Connect local scripts through the [local API server](api-server.md).
- Inspect model health and storage use with [Repair](repair.md).

## Troubleshooting

- If `npm run doctor` reports a failed prerequisite, correct that item and run it again.
- If every larger model is marked unable to fit, select a smaller model or context window; the fit
  result is based on the current memory budget.
- If a development server is already using port 5173, stop it or configure a free port as described
  in [Setup](setup.md).
- Gatekeeper or Keychain prompts can occur with local ad-hoc builds. Supported consumer builds must
  be Developer ID signed and notarized.
- If installation or startup fails, run `npm run diagnostics` and include its privacy-safe output,
  the failing command, and the operating-system version in a GitHub issue.

Continue with [Setup](setup.md) or [Architecture](architecture.md).
