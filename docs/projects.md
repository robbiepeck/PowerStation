# Projects (workspaces) & backup

## Projects

A project bundles the context you'd otherwise rebuild per chat. The switcher at the top of the
sidebar moves between **Personal** (your global setup, untouched) and any project you create.

A project can hold, all optional except the name:

- **Instructions** — appended to the global system prompt for every chat in the project. The
  model-side effect is identical to typing them into Utilities → System prompt, but scoped.
- **Knowledge folder** — indexed locally (same engine as chat-with-a-folder); every new chat in
  the project starts with it attached and answers cite sources. If the index is missing — say,
  after restoring on a new machine — it rebuilds quietly in the background.
- **Skills** — per-project mode overrides (*Off / Auto / Always here*). Skills you don't override
  keep their global mode.
- **Connectors** — a checklist of your configured MCP servers; only checked ones run while the
  project is active. Adding a connector while a project is active enables it there too.
- **Model** — selected automatically when you switch to the project.

Chats are stamped with the project they were started in and never migrate; the sidebar lists the
active workspace's history (Personal shows unassigned chats). Deleting a project keeps its chats.

On disk a project is one JSON file in the app's data folder (`projects/`), the same transparent
storage as chats — revealable, readable, yours.

## Backup & restore

Settings → **Backup & restore** writes a single JSON archive containing settings, tool
permissions, benchmarks, skills, chats, projects, agents, and scheduled-job definitions. Restore
on any machine:

- **Settings and permissions are replaced** by the backup's values.
- **Scheduled jobs are imported under fresh ids.** Jobs whose pinned model is absent are paused;
  run history is intentionally not included.
- **Chats, skills and projects overwrite items with the same id**; everything else you already
  have stays.
- **Model weights never travel** — they're huge and re-downloadable. Their catalogue entries and
  import paths restore, and models appear again as soon as the files exist locally.
- Every restored value passes the **same sanitizers as a normal config read** — a hand-edited
  archive can't smuggle in states the app would never write itself.

Knowledge-folder indexes are rebuilt rather than backed up (they're derived data and
machine-specific); a restored project re-indexes its folder on first use.

*Related: [Agent harness](agent-harness.md) · [Memory & monitoring](memory-and-monitoring.md).*
