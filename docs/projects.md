# Projects and backup

Projects collect reusable workspace context. Backups export PowerStation configuration and content
in a readable JSON archive for recovery or migration.

## Projects

The workspace switcher in the sidebar moves between **Personal** and user-created projects. Personal
uses the global configuration. Each project may define:

- **Instructions** — appended to the global system prompt for chats in the project.
- **Knowledge folder** — locally indexed and attached to new project chats, with source citations.
- **Skill modes** — project-specific `Off`, `Auto`, or `Always here` overrides. Skills without an
  override retain their global mode.
- **Connectors** — the configured MCP servers available while the project is active.
- **Preferred model** — selected automatically when the project becomes active.

Chats retain the project ID assigned when they are created and do not move automatically between
workspaces. The sidebar displays the active project's history; Personal displays chats without a
project. Deleting a project preserves its existing chats.

Each project is stored as a readable JSON file in the `projects/` directory under PowerStation's
user-data directory. Project files can be revealed and inspected outside the application.

## Backup contents

Open **Settings → Backup & restore** to write one versioned JSON archive containing:

- settings and tool permissions;
- model registrations and benchmark records, but not model weights;
- skills, chats, projects, and agents;
- scheduled-job definitions, but not scheduled run history.

Knowledge-folder indexes are derived, machine-specific data and are not included. PowerStation
rebuilds an index when the referenced folder is available on the restored computer.

## Restore behaviour

Restore applies the following merge rules:

- settings and tool permissions are replaced by the archive values;
- chats, skills, projects, and agents with matching IDs are overwritten;
- unrelated existing items remain in place;
- scheduled jobs are imported with new IDs;
- jobs whose pinned model is unavailable are restored in a paused state;
- model registrations reappear when their referenced files exist locally.

Every restored value passes the same validation and sanitisation used for normal configuration
reads. Hand-editing an archive cannot introduce an unsupported application state through fields the
parser rejects.

## Security and portability

A backup may contain sensitive chats, instructions, attachment text, permissions, and configuration.
Store and transmit it as a sensitive file. PowerStation does not independently encrypt backup
archives.

Folder paths, imported model paths, and connector IDs may not resolve on another computer. Missing
resources degrade safely: indexes can be rebuilt, models can be downloaded or re-imported, and
connectors can be configured again.

See [Agents](agents.md), [Schedules](schedules.md), and [Security](../SECURITY.md).
