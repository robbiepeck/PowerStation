# Quick Start

From a clean checkout to your first local chat in a few minutes.

## 1. Requirements

- **macOS on Apple Silicon** (M-series) with **16 GB unified memory or more**, or
  **Windows 10/11 x64** / **Linux x64** (beta) with **16 GB RAM** — ideally with a discrete GPU
  (8 GB+ VRAM).
- **Node.js 22+** and **npm**.
- macOS only: Xcode Command Line Tools (`xcode-select --install`) — the native runtime ships
  prebuilt, but the CLT are handy if a source build is ever needed.

PowerStation publishes source-only releases. On macOS the supported installer builds and signs the
app locally, avoiding the risks and warnings of distributing an unnotarized binary.

## 2. Get it running

```bash
git clone --depth 1 --branch v0.19.1 https://github.com/robbiepeck/PowerStation.git
cd PowerStation
npm run doctor
npm run install:mac
```

`install:mac` installs the locked dependencies, builds the app locally, verifies it, installs it to
Applications, and opens it. It preserves existing models, chats and settings. See the
[Source Install guide](source-install.md) for updates and privacy-safe diagnostics.

## 3. First run: pick a model

The app opens on a **scan-and-reveal** screen — it has already read your chip, memory, usable-for-AI
budget and free disk. Then:

1. **Continue** past the hardware reveal.
2. Answer two questions: **what you'll use it for** (everyday / coding / agents / documents /
   reasoning) and **faster vs. smarter**.
3. PowerStation shows up to **three recommended models** with honest capability cards and expected
   speed for your machine. Pick one and hit **Download & set up** — it downloads into the app's
   managed models folder and loads automatically.
4. You land in a working **chat**, running entirely on your machine.

Prefer to choose yourself? Every card in the **Models** tab shows a *fits comfortably / tight /
won't fit* badge computed from real memory math, plus what each model is honestly good and bad at.
Full list in [Models & devices](models-and-devices.md).

## 4. Try the agent tools (optional)

If you picked an **Agent-ready** model, open **Utilities** and add an MCP server, for example:

```
npx -y @modelcontextprotocol/server-filesystem ~/Documents
```

PowerStation connects over stdio, lists the server's tools with a context-cost meter, and when the
model wants to call a tool you get an **allow once / allow rest of turn / always allow / deny**
prompt. Details in the [Agent harness](agent-harness.md) guide.

## 5. Watch the machine

The **status pill** in the chat header is your ambient monitor — "Running smoothly · N tok/s", or an
amber/red warning if memory gets tight (or battery gets low). Click it (or the **Monitor** tab) for
the full live view of CPU, RAM, GPU, VRAM, storage, memory pressure, power, battery and thermal
headroom, each labelled as measured or estimated.

## 6. Where to next

- **Attach a folder** (from the composer) to chat with your documents, with cited sources.
- **Create a project** (switcher at the top of the sidebar) to bundle instructions, a knowledge
  folder, skills, and connectors into a workspace. → [Projects & backup](projects.md)
- **Compare two models** (Models tab) before committing to one; import models you already have in
  Ollama or LM Studio without re-downloading. → [Models & devices](models-and-devices.md)
- **Check the Repair tab** if disk space is tight — honest storage intelligence for AI files.
  → [Repair](repair.md)
- **Create a schedule** for a bounded recurring prompt. Scheduled runs remain inference-only and
  local. → [Schedules](schedules.md)

## Troubleshooting

- **"Won't fit" on every big model** — expected; your memory tier can't hold them. Stick to the
  models marked *fits comfortably*. See [Models & devices](models-and-devices.md).
- **The prerequisite check fails** — fix the failed item shown by `npm run doctor`, then retry.
- **A build step fails** — run `npm run diagnostics` and include its privacy-safe output in an issue.

Next: [Setup Guide](setup.md) · [Architecture](architecture.md)
