# Agents — reusable assistants

The **Agents** tab is PowerStation's take on the Microsoft-365 agent-builder idea, scoped to what
a strictly-local app can honestly deliver: a named, reusable assistant made of **instructions**
and the **knowledge folders** it answers from. Build one once, start chats with it whenever.

## What an agent is

- **A face and a name** — an emoji and a one-line description, shown on its card and on every
  chat it powers.
- **Instructions** — appended to the system prompt for every message in the agent's chats, after
  the global prompt and any active project's instructions (most specific last).
- **Knowledge folders (up to 8)** — indexed locally with the same engine as chat-with-a-folder.
  At question time the agent retrieves across *all* its folders at once: the query is embedded
  once and chunks from every folder compete for the same top-k slots, so the best evidence wins
  no matter where it lives. With more than one folder, citations are folder-prefixed
  (`finance-notes/budget.md`) so sources stay unambiguous.
- **Connectors (optional)** — the MCP servers the agent may use. Leave all unchecked and the agent
  uses whatever connectors are normally on; check some and its chats are scoped to exactly those
  while active (an empty list never silences tools, it just inherits). Every tool call stays
  permission-gated and audit-logged as always. Precedence when several things are in play: an
  active agent's connectors win over a project's, which win over the global enabled set.

Deliberately **not** part of an agent: model binding. An agent shapes the conversation; the model
stays whatever you've selected.

## Using agents

**Start chat** on an agent's card opens a fresh conversation with that agent applied; the chat
header shows its chip, and the sidebar row carries its emoji so agent chats are recognisable
later. Reopening a saved agent chat restores the agent (and its connector scope). **New chat**
always starts plain.

Agents and **projects** compose: a project is a workspace you switch into (scoping your chat
list); an agent is an assistant you summon per chat. Inside a project, an agent chat gets both
sets of instructions — project first, agent second.

Deleting an agent keeps every chat made with it (the badge stays, denormalized); only the
reusable definition goes away.

## Share an agent

An agent is one JSON file, so it travels: **Export…** in the agent editor writes a
`*.agent.json` file; **Import** on the Agents tab reads one back in under a fresh id (so importing
never overwrites an existing agent). Knowledge-folder references travel too — on another machine
they simply retrieve nothing until those folders exist and are re-indexed, and connector ids that
don't resolve there just connect nothing. Nothing errors; the agent degrades gracefully.

## Plan preview

Independently of agents, Settings → Agent trust has **Preview the plan before tool use**. When on,
a tool-capable model first proposes the steps it intends to take before a multi-tool turn; you
approve the plan once (every tool call in the turn then runs without a prompt) or cancel and
nothing runs. Every call is still audit-logged. It pairs naturally with agents that have
connectors. See the [Agent harness](agent-harness.md).

## Where they live

One JSON file per agent in the app's data folder (`agents/`) — revealable from the tab, editable
outside the app, included in [backups](projects.md), and restored with everything else.

*Related: [Projects & backup](projects.md) · [Agent harness](agent-harness.md) (permissions and
tools) · [Memory & monitoring](memory-and-monitoring.md).*
