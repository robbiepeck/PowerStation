# Agents

An agent is a reusable assistant configuration that applies instructions, local knowledge folders,
and an optional connector scope to a new chat. Agents are separate from projects and do not bind a
specific model.

## Agent configuration

Each agent can define:

- **Name, icon, and description** — shown in the Agents view, chat header, and chat history.
- **Instructions** — appended to the effective system prompt after global and project instructions.
- **Knowledge folders** — up to eight locally indexed directories. Retrieval searches all selected
  folders together and returns the highest-ranking chunks across the combined result set.
- **Connectors** — an optional list of configured MCP servers available in the agent's chats.

When several connector scopes apply, precedence is:

```text
agent → project → globally enabled connectors
```

Leaving the agent's connector list empty inherits the next available scope. Selecting connectors
restricts the agent to that exact set. Every tool invocation remains subject to the normal permission,
preview, and audit workflow.

Agents do not select or package a model. A chat created from an agent uses the model currently
selected in PowerStation.

## Start and resume agent chats

Select **Start chat** on an agent card to create a conversation with that configuration. The chat
header displays the agent, and the sidebar uses its icon to distinguish the conversation. Reopening a
saved chat restores the associated agent and connector scope. Selecting the standard **New chat**
action creates an unconfigured conversation.

Projects and agents can be combined. A project supplies workspace context and filters the visible
chat history; an agent supplies assistant-specific context to an individual chat. Project instructions
are applied before agent instructions.

Deleting an agent does not delete its existing chats. The saved chat retains denormalised display
metadata, while the reusable agent definition is removed.

## Knowledge retrieval

At question time, PowerStation embeds the query once and searches all of the agent's indexed folders.
Chunks compete for the same result limit so that evidence quality determines selection rather than
folder order. When an agent uses multiple folders, citations include the folder prefix, for example
`finance-notes/budget.md`.

If a folder is unavailable or has not yet been indexed, the remaining agent configuration continues
to work. Re-index the folder on the destination computer to restore retrieval.

## Export and import

Select **Export** in the agent editor to create a versioned `*.agent.json` file. Select **Import** in
the Agents view to add an exported definition. Import assigns a new internal ID and never overwrites an
existing agent.

Folder references and connector IDs are included. On another computer, unavailable folders return no
retrieval results and unknown connectors remain inactive until matching resources are configured. The
export does not include model weights or folder contents.

Treat imported agent files as untrusted configuration. PowerStation validates them through the same
format parser used for stored definitions.

## Plan preview

**Settings → Agent trust → Preview the plan before tool use** adds an optional planning step for
multi-tool turns. A capable model proposes its intended steps in an isolated pass. Approving the plan
authorises tool calls for that turn; cancelling prevents execution. Calls are still recorded in the
audit log.

Plan preview reduces repeated confirmation prompts but grants authority to the approved turn as a
whole. Review the proposed scope carefully, especially for file-writing or network-enabled tools.

## Storage and backup

Agents are stored as individual JSON files in the `agents/` directory under PowerStation's user-data
directory. They can be revealed from the application, are included in normal backups, and can be
edited outside the app if their schema is preserved.

See [Projects and backup](projects.md), [Agent harness](agent-harness.md), and
[Security](../SECURITY.md).
