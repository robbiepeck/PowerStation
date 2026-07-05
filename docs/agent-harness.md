# Agent harness

PowerStation's agent layer lets a local model use tools — files, search, APIs — through
[Model Context Protocol](https://modelcontextprotocol.io) servers, with guardrails designed for the
reality that small local models are less reliable and more injectable than frontier models.

The three ideas that make it work: **permissions on every call**, **capability gating by model**, and
**loop guards**.

## Connecting a tool server

Open **Utilities** and add an MCP server by name and command, for example:

```
npx -y @modelcontextprotocol/server-filesystem ~/Documents
```

PowerStation spawns it over **stdio** (in the main process, never the renderer), lists its tools, and
shows a live status badge — *connected · N tools*, *connecting*, or *error* with the message. Servers
can be toggled on/off individually.

> **PATH note:** GUI apps on macOS don't inherit your shell's PATH, so `npx`/`uvx`/`node` would
> otherwise fail with ENOENT. PowerStation fixes the PATH at startup before spawning any server.

## Permissions: allow / ask / deny

Every tool call the model makes is gated. The default for any new tool is **ask**:

- When the model calls a tool, a modal shows the server, the tool name, and the exact arguments.
- You choose **Allow once**, **Always allow** (remembered per tool), or **Deny**.
- Per-tool defaults are editable any time in Utilities (**Ask every time** / **Always allow** /
  **Never allow**).

Denied calls return a message telling the model not to retry — so a refusal doesn't spiral into a
loop. If a prompt sits unanswered too long it auto-denies and the modal is dismissed, so a late click
can never appear to grant something that was already refused.

Tool **output is treated as untrusted data**: it's capped in size, framed to the model as data rather
than instructions, and never executed. This matters because a poisoned file or web page read by a
tool is a classic prompt-injection vector — see the [Threat model](../THREAT_MODEL.md).

## Capability gating

Not every model can drive tools, and a model flailing at broken tool calls reads as a broken app.
PowerStation resolves each model's **tool-calling tier** — from the catalogue, or from the GGUF's
embedded chat template for imported models — and gates accordingly:

| Tier | Meaning | In the app |
| --- | --- | --- |
| **multi** | Trained for multi-step agent loops | Full harness, up to **15** tool calls per turn. |
| **single** | Reliable single/parallel calls | Tools enabled, capped at **3** tool calls per turn. |
| **chat** | Not tool-trained | MCP tools **greyed out**, with the reason stated. |

This is the differentiator: rather than exposing tools on every model and letting weak ones fail,
PowerStation shows honestly what your selected model can do.

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

## Under the hood

- `electron/mcp.ts` — the MCP client manager: single-flight connects (no duplicate child processes),
  tool discovery, and `tools/call` with timeouts.
- `electron/agent.ts` — the permission-gated executor that sits between the model's tool calls (raised
  inside the worker) and the MCP servers, plus the tool-schema token estimate.
- `electron/llmWorker.ts` — where tool calls are surfaced and the loop guards live; tool parameters
  are constrained to a JSON-schema grammar so calls are well-formed by construction.

See [Architecture](architecture.md) for how a tool call flows end to end, and
[Security](../SECURITY.md) for the trust model.
