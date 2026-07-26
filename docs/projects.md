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

- portable settings, without API tokens or remembered tool approvals;
- skills and chats;
- project and agent content, without local folder or connector assignments;
- scheduled-job definitions, but not scheduled run history.

Model registrations, model weights, benchmark records, and knowledge-folder indexes are
machine-specific and are not included.

## Restore behaviour

Restore applies the following merge rules:

- portable settings are replaced by the archive values;
- remembered tool approvals reset to Ask and the local API remains off;
- chats, skills, projects, and agents with matching IDs are overwritten;
- unrelated existing items remain in place;
- scheduled jobs are imported with new IDs;
- every imported job remains paused until reviewed;
- existing local model registrations remain in place.

Every restored value passes the same validation and sanitisation used for normal configuration
reads. Hand-editing an archive cannot introduce an unsupported application state through fields the
parser rejects.

## Security and portability

A backup may contain sensitive chats, instructions, attachment text, and configuration.
Store and transmit it as a sensitive file. PowerStation does not independently encrypt backup
archives.

Backups deliberately exclude API bearer tokens, local folder and model paths, connector assignments,
and remembered tool approvals. Restoring leaves the local API off, resets tools to Ask, and requires
local resources to be attached again. Scheduled jobs retain their model reference only to help the
user reselect a model, and every restored job stays paused until reviewed.

See [Agents](agents.md), [Schedules](schedules.md), and [Security](../SECURITY.md).
