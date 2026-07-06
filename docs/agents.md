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

Deliberately **not** part of an agent: model binding and connector selection. An agent shapes the
conversation; the model stays whatever you've selected, and tools remain governed by the
connector settings, trust profile, and permission prompts exactly as everywhere else.

## Using agents

**Start chat** on an agent's card opens a fresh conversation with that agent applied; the chat
header shows its chip, and the sidebar row carries its emoji so agent chats are recognisable
later. Reopening a saved agent chat restores the agent. **New chat** always starts plain.

Agents and **projects** compose: a project is a workspace you switch into (scoping your chat
list); an agent is an assistant you summon per chat. Inside a project, an agent chat gets both
sets of instructions — project first, agent second.

Deleting an agent keeps every chat made with it (the badge stays, denormalized); only the
reusable definition goes away.

## Where they live

One JSON file per agent in the app's data folder (`agents/`) — revealable from the tab, editable
outside the app, included in [backups](projects.md), and restored with everything else.

*Related: [Projects & backup](projects.md) · [Agent harness](agent-harness.md) (permissions and
tools) · [Memory & monitoring](memory-and-monitoring.md).*
