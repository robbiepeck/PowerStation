# Agent harness

PowerStation allows compatible local models to invoke tools through
[Model Context Protocol](https://modelcontextprotocol.io) servers. The harness is designed around
three controls: explicit permissions, model capability gating, and bounded tool loops. These controls
reduce the effect of model errors and prompt injection but do not make third-party tools trustworthy.

## Skills

Skills are reusable instruction packs: plain Markdown files in PowerStation's data folder, added to
the system prompt while enabled. They work with **every** model, including chat-only ones, and are
the fastest way to make a small model reliably good at one job.

- **Starters included**: Concise answers, Code reviewer, Writing editor, Meeting notes → actions, and
  Step-by-step tutor ship with the app (seeded on first run; edit or delete them freely).
- **Create and edit in-app** (Utilities → Skills), or drop `.md` files into the skills folder — the
  format is a tiny frontmatter block (`name`, `description`) followed by the instructions.
- **Token-metered**: enabled skills show their context cost, with a warning when they start crowding
  out conversation on small context windows.
- **Three activation modes**: *Always* (every message), *Auto* (only when a message matches the
  skill's `triggers:` — keeping small contexts lean), or *Off*. Each reply's admission line names
  the skills that applied, and activating a skill mid-chat preserves the conversation.
- **A gallery of curated skills** (Utilities → Skills → *Browse gallery*) installs with one click:
  each entry becomes an ordinary markdown file in your skills folder. The gallery lives in
  [`catalog/skills.json`](../catalog/skills.json) — remotely updatable and CI-validated, same as
  the model and connector catalogues.

```markdown
---
name: Concise answers
description: Short, direct replies — no filler.
---
Answer as briefly as the question allows...
```

## Connector gallery

Utilities → **Connector gallery** offers curated MCP servers — one click, no commands to paste. Every
entry is a verified npm package, spawned as `npx -y <package>` with validated arguments only:

| Connector | What the model gets | Notes |
| --- | --- | --- |
| **Local files** | Read/write/search files in a folder you pick | Official · scoped to the chosen folder |
| **Memory** | A local knowledge graph that persists across chats | Official · stored in the app's data folder |
| **Web reading** | Fetch pages as clean markdown | Community · uses the internet |
| **Web search** | DuckDuckGo search, no API key | Community · uses the internet |
| **Sequential thinking** | A structured reasoning scratchpad | Official · measurably helps small models |
| **Kitchen sink (demo)** | 13 harmless sample tools | Official · for trying out the harness |

The gallery is data rather than executable application code. It is defined in
[`catalog/connectors.json`](../catalog/connectors.json), fetched alongside the model catalogue and
strictly validated (npm package-name pattern, no flag
injection, folder arguments only from the OS folder picker).

## Connect a custom server

Anything not in the gallery: open **Utilities** and add an MCP server by name and command, for
example:

```text
npx -y @modelcontextprotocol/server-filesystem ~/Documents
```

PowerStation spawns it over **stdio** (in the main process, never the renderer), lists its tools, and
shows a live status badge — *connected · N tools*, *connecting*, or *error* with the message. Servers
can be toggled on/off individually.

> [!NOTE]
> GUI applications on macOS do not inherit the interactive shell's `PATH`. PowerStation resolves a
> suitable path at startup before spawning commands such as `npx`, `uvx`, or `node`.

## Tool permissions

Every tool call the model makes is gated. The default for any new tool is **ask**:

- When the model calls a tool, a modal shows the server, the tool name, and the exact arguments —
  and for file writes, edits and moves, a **real diff** against the file's current content, so you
  approve the change itself rather than raw JSON.
- You choose **Allow once**, **Allow rest of turn**, **Always allow** (remembered per tool), or
  **Deny**.
- **Allow rest of turn** covers this call *and any further ask-gated calls the model makes before
  the current reply finishes* — one approval for a multi-step task instead of five prompts. The
  grant is scoped to that single turn and expires with it; it never changes a tool's standing
  permission.
- Per-tool defaults are editable any time in Utilities (**Ask every time** / **Always allow** /
  **Never allow**).

Every call is also recorded in the per-chat **audit log** (the shield button in the chat header):
the preview shown, the decision made — allowed once, for the turn, always, auto-allowed, denied,
or blocked — the outcome, and the duration. The log persists with the chat and exports as JSON or in the
Markdown chat export.

Denied calls return a message telling the model not to retry — so a refusal doesn't spiral into a
loop. If a prompt sits unanswered too long it auto-denies and the modal is dismissed, so a late click
can never appear to grant something that was already refused.

Tool **output is treated as untrusted data**: it's capped in size, framed to the model as data rather
than instructions, and never executed. This matters because a poisoned file or web page read by a
tool is a classic prompt-injection vector — see the [Threat model](../THREAT_MODEL.md).

## Trust profiles and plan preview

Settings → **Agent trust** switches how remembered choices behave:

- **Trusted** (default) — per-tool memory applies: a tool you set to *Always allow* runs without
  asking again.
- **Cautious** — every tool call asks, every time. Remembered allows are **suspended, not
  deleted** — switch back and they apply again exactly as before. "Allow rest of turn" still works
  (it's an explicit, turn-scoped answer), *Never allow* still blocks silently, and every call is
  audit-logged in both modes. A chip in the chat header shows while cautious mode is on.

The same section has **Preview the plan before tool use** (off by default). When on, a tool-capable
model runs a short planning pass *before* a multi-tool turn — an isolated probe that leaves the
conversation untouched — and proposes the steps it intends to take. You approve the plan once (every
tool call in that turn then runs without a per-call prompt) or cancel and nothing runs. Every call
is still audit-logged; this trades per-call prompts for one up-front decision on multi-step tasks,
and pairs naturally with an [agent](agents.md) that scopes its own connectors.

## Built-in repair tools

Beyond MCP servers, PowerStation ships **first-party tools** the model can call — currently the
Repair toolset (`powerstation:storage_report`, `list_reclaimables`, `clean_reclaimable`,
`check_model_integrity`). They ride the exact same rails as external tools — the same ask/allow/deny
prompts, previews, and audit log — and the one mutating tool resolves its target through the Repair
tab's id allowlist and containment guard, so the model **cannot express an out-of-contract
delete** no matter what it generates (see [Repair](repair.md)).

They register only when the bundled **Storage repair** skill is active for the message: the skill
teaches the workflow (diagnose first, propose, act only on consent), and its Off/Auto/Always mode
doubles as the feature switch, so the tool schemas cost no context tokens otherwise. The skill
ships **off** — enable it in Utilities → Skills.

## Capability gating

Not every model can produce valid tool calls. PowerStation resolves each model's
**tool-calling tier** from the catalogue, or from the GGUF's
embedded chat template for imported models — and gates accordingly:

| Tier | Meaning | In the app |
| --- | --- | --- |
| **multi** | Trained for multi-step agent loops | Full harness, up to **15** tool calls per turn. |
| **single** | Reliable single/parallel calls | Tools enabled, capped at **3** tool calls per turn. |
| **chat** | Not tool-trained | MCP tools **greyed out**, with the reason stated. |

Capability gating prevents the interface from offering an agent workflow to a model that is not
expected to produce valid tool calls.

## Context budget metering

MCP tool schemas consume context — one server with 40 tools can eat a large slice of a small model's
window before the conversation even starts. The Utilities panel shows a **context meter**: how many
tokens the connected tools' definitions use out of your context window, with a warning past 25%. Turn
off servers you aren't using to reclaim that space.

## Loop guards

Small models are prone to retry storms and unbounded tool loops that bloat context and compound
errors. The inference worker enforces two hard guards:

- **Repeated-call halt** — the exact same tool call three times in a turn stops generation.
- **Call budget** — a per-turn cap (15 for multi-tier, 3 for single) stops runaway loops.

When either fires, the chat shows a clear note explaining what happened and how to continue.

## Implementation references

- `electron/mcp.ts` — the MCP client manager: single-flight connects (no duplicate child processes),
  tool discovery, and `tools/call` with timeouts.
- `electron/agent.ts` — the permission-gated executor that sits between the model's tool calls (raised
  inside the worker) and the MCP servers, plus the tool-schema token estimate.
- `electron/llmWorker.ts` — where tool calls are surfaced and the loop guards live; tool parameters
  are constrained to a JSON-schema grammar so calls are well-formed by construction.

See [Architecture](architecture.md) for how a tool call flows end to end, and
[Security](../SECURITY.md) for the trust model.
