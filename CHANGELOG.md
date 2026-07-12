# Changelog

The "See what's new" card in the app links here.

## v0.19.1 — Verified platform installs

- **Installed-app launch coverage** — CI now installs and launches the Windows NSIS package, Linux
  Debian package and AppImage, and the locally built macOS app in clean profiles. Each test checks
  the packaged preload bridge, primary navigation, scheduler IPC and editor, settings persistence,
  and controlled process teardown.
- **Quit cannot hang indefinitely** — after normal shutdown cleanup begins, PowerStation now has a
  five-second last-resort exit. This fixes packaged Windows and constrained macOS environments that
  could remain running after an explicit Quit request.
- **Stable source instructions on every platform** — Windows and Linux setup commands now pin the
  same stable release tag as macOS instead of silently cloning the moving development branch.

## v0.19.0 — Quiet automation

- **Scheduled local-model jobs** — the new Schedules workspace runs validated five-field cron
  expressions in explicit timezones against a pinned installed model. Jobs have friendly presets,
  Run now, pause/edit/delete controls, token and time bounds, missed-run policy, battery gating,
  status-only notifications, start-at-login support, and a durable local run ledger.
- **Unattended means less authority** — scheduled runs are isolated raw inference. They never
  receive MCP tools, built-in tools, skills, project context, retrieval, API credentials, or shell
  access. They use the existing model-fit and memory-pressure gates, serialize with chat/API work,
  skip overlaps, suppress duplicate daylight-saving minutes, and terminate a stuck worker after a
  bounded grace period.
- **Portable definitions** — backups include scheduled-job definitions but omit result history;
  jobs whose pinned model is missing restore paused. A single-instance app lock prevents login and
  manual launches from creating competing schedulers.

## v0.18.1 — Source installation

- **Frictionless local macOS build** — stable source releases now include doctor, atomic install,
  update, and privacy-safe diagnostic commands. The locally built app is ad-hoc signed and verified
  before replacing an existing installation; chats, settings, and models are preserved.
- **Source-only public releases** — CI tests unsigned packages on each target operating system but
  publishes no consumer binaries without platform signing. The in-app updater directs macOS users
  to the source update guide.

## v0.18.0 — Local API server

- **OpenAI-compatible API server** — Settings → *Local API server* turns your running model into an
  endpoint other apps and scripts on this Mac can call with the standard OpenAI SDK, entirely
  offline. Off by default, bound to `127.0.0.1` only, and gated by a generated **bearer token** you
  copy from Settings (Regenerate to revoke). Endpoints: `GET /v1/models`, `POST /v1/chat/completions`
  (streaming and non-streaming), `POST /v1/embeddings`. Requests are **raw inference** — the caller
  controls the messages; your app system prompt, skills, and tools are not applied — and they run
  one at a time (the model loads once). Every request appears in a live log in Settings, and each
  call still passes admission control, so an over-large request gets an honest error instead of
  swapping your Mac. See [docs/api-server.md](docs/api-server.md).

## v0.17.0 — Delete models to reclaim space

- **Delete an installed model from disk** — each model in the Models view now has a clear
  **Delete** button that permanently removes the model to free up space (distinct from "Remove",
  which only unregisters an imported file without touching disk). The confirmation shows the exact
  size that will be freed, and a summary reports how much was reclaimed. **Multi-part (split) GGUF
  models now delete every part** — previously only the first shard was removed, leaving gigabytes
  behind. If the model being deleted is the one currently loaded, it's unloaded first so the space
  is actually released.

## v0.16.0 — Agents that travel and act

- **Export & import agents** — an agent is one JSON file, so it travels. **Export…** in the agent
  editor writes a `*.agent.json`; **Import** on the Agents tab reads one back under a fresh id (so
  it never overwrites an existing agent). Knowledge-folder references and connector ids travel too
  and degrade gracefully on a machine that lacks them.
- **Agent connectors** — an agent can now name the MCP servers it may use. Leave them unchecked to
  inherit whatever's normally on; check some to scope the agent's chats to exactly those while
  active (precedence: agent → project → global). Tool calls stay permission-gated and audit-logged.
- **Plan preview** — Settings → Agent trust → *Preview the plan before tool use*. When on, a
  tool-capable model proposes its steps before a multi-tool turn (via an isolated planning pass
  that leaves the conversation untouched); approve the plan once to run the whole turn without a
  per-call prompt, or cancel and nothing runs. Every call is still audit-logged.

## v0.15.0 — Agents

- **Agents tab** — reusable assistants in the Microsoft-365 agent-builder spirit, fully local:
  a name and emoji, instructions appended to the system prompt, and up to **eight knowledge
  folders**. Retrieval runs across all of an agent's folders at once — chunks compete for the same
  top-k slots, and citations are folder-prefixed when there's more than one. **Start chat** on a
  card opens a conversation with the agent applied; the chat header shows its chip and the sidebar
  row its emoji, and reopening the chat restores the agent. Deliberately separate from Projects:
  a project is a workspace you switch into, an agent is an assistant you summon per chat — inside
  a project you get both sets of instructions. Agents are plain JSON files (`agents/`), revealable
  from the tab, included in backups, and deleting one keeps its chats (badge and all).

## v0.14.0 — Repair, conversationally

- **Storage repair as an agent skill** — a new bundled skill (Utilities → Skills → *Storage
  repair*; ships off, enable to opt in). When active, the model can diagnose disk usage and — with
  your consent — reclaim PowerStation-owned space through built-in tools that ride the exact same
  rails as MCP tools: permission prompts, previews, and the audit log. The approval dialog shows
  precisely what would be removed and the consequence, and the one mutating tool resolves through
  the same id allowlist and containment guard as the Repair tab's buttons — the model cannot
  express an out-of-contract delete no matter what it generates. The skill's instructions bind it
  to the Repair contract: diagnose first, real numbers only, propose then act on consent, never
  touch anything PowerStation didn't create, never promise speed-ups.
- **Smarter skill seeding** — new bundled skills now reach existing installs once, while skills
  you deliberately deleted stay deleted.
- **Documentation refresh** — README and every guide brought up to date with v0.10–v0.14:
  projects, backup, repair (tab + skill), compare, trust profiles, battery/energy telemetry,
  imports, and the expanded module map.

## v0.13.0 — Confident choices

- **Compare two models** — Models → *Compare two models*: one prompt, both models, measured side by
  side (write speed, first-token latency, total time), with "Use this model" on the winner. Runs are
  deliberately sequential — the worker holds one model at a time, so each candidate gets the whole
  machine: fair timings, no memory gamble. Each side passes the same admission check as a normal
  chat; a model that doesn't fit shows its honest refusal in its column.
- **Agent trust profiles** — Settings → Agent trust: **Trusted** (remembered per-tool choices apply,
  today's behaviour) or **Cautious** (every tool call asks, every time; remembered allows are
  suspended, not deleted). "Allow rest of turn" still works in cautious mode, Never-allow still
  blocks silently, and everything is audit-logged in both. A chip in the chat header shows when
  cautious mode is on.
- **"Why this over that"** — recommendations (onboarding and the Models panel) now explain each
  alternate against the top pick on the axes that differ: fit on your machine, measured or likely
  speed, knowledge capacity, and tool-calling strength — honest in both directions when the
  alternate wins an axis.

## v0.12.0 — Repair

- **Repair tab** — storage and health for AI workloads, built on one hard rule: *PowerStation never
  deletes or edits anything outside its own data folder.* Read-only scans of the well-known homes of
  AI files (Downloads, Trash, Hugging Face cache, Ollama, LM Studio, PowerStation's own data) with
  "Reveal in Finder" as the only action on external paths; cross-app **duplicate model detection**
  (exact name + size, deliberately conservative); a **reclaim** list scoped to data PowerStation
  itself created (orphaned folder indexes, the re-downloadable embeddings model, rebuildable
  catalogue caches) with per-item confirmation and a persistent removal log; **model file health
  checks** (GGUF signature + size vs the catalogue) that catch corrupt downloads before they crash a
  chat; and an explicit "What Repair won't do" card. Every delete passes a symlink-resolving
  containment guard that is unit-tested against traversal and symlink-escape attacks.

## v0.11.0 — Projects

- **Projects (workspaces)** — the switcher at the top of the sidebar bundles what you'd otherwise
  set up per chat: project instructions (added to the system prompt), a knowledge folder (attached
  to every new chat, answers cite sources), per-project skill modes, a connector selection (only
  checked servers run while the project is active), and a preferred model. Chats belong to the
  project they were started in; the sidebar shows the active workspace's history. Projects are
  plain JSON files in the data folder, like chats.
- **Backup & restore** — Settings → Backup & restore writes one readable JSON file with your
  settings, tool permissions, benchmarks, skills, chats, and projects. Restoring replaces settings
  and permissions and overwrites same-id content; model weights don't travel (their entries
  reappear once the files exist). Everything passes the same sanitizers as normal config reads.

## v0.10.0 — Daily driver

- **LM Studio import** — models you already downloaded with LM Studio appear in the Models view
  and register with one click: no re-download, no extra disk, same admission checks. Works exactly
  like the Ollama import (split GGUFs are priced as the whole series).
- **Pin & rename chats** — pin conversations to the top of the sidebar; rename them inline
  (pencil on hover, Enter to save, Esc to cancel). Renamed titles stick — they stop auto-deriving
  from the first message; clearing the name hands the title back.
- **"Allow rest of turn"** — a new option in the tool permission dialog: approve the current call
  and any further calls the model makes before this reply finishes, without weakening standing
  permissions. The grant dies with the turn, and every call still lands in the audit log as
  *allowed for the turn*.
- **Battery & energy awareness** — the monitor shows battery state; the status pill warns below
  25% on battery (lighter models draw less power); and the chat header shows an estimated
  watt-hours figure for the session's generation — labelled a ballpark, because the power reading
  itself is an estimate.

## v0.9.0 — Accountability

- **Tool audit log** — the shield button in any chat with tool activity opens a full record:
  every call, the diff that was previewed, your allow/deny decision (including auto-allowed and
  blocked), whether it ran, and how long it took. Persists with the chat, appears in Markdown
  exports, and exports as JSON. Diff previews show what *will* happen; the log proves what *did*.
- **Knowledge folder manager** — Settings lists every indexed folder with its size and a
  freshness badge ("folder changed" when contents drifted since indexing), plus one-click
  re-index and delete. The chat's folder chip also flags stale indexes.

## v0.8.0 — Skills gallery

- **Skills gallery** — Utilities → Skills → *Browse gallery*: eight curated skills (email drafter,
  commit messages, plain-English translator, devil's advocate, Socratic brainstormer, regex helper,
  standup formatter, SQL helper) install with one click as ordinary markdown files — yours to edit,
  retrigger, or delete. The gallery is remotely updatable via `catalog/skills.json`, validated in
  CI like the model and connector catalogues.

## v0.7.0 — Long conversations

- **Auto-compaction** — when a chat nears the context limit, the model summarizes its older turns
  for itself and keeps going; the transcript you see is never shortened, and a notice in the chat
  (hover for the summary) shows exactly what the model now remembers. Toggle in Settings.
- **Reading-speed benchmark** — benchmarks now measure prompt ingestion alongside generation
  ("reads 1,500 tok/s · writes 34 tok/s"), the number that actually gates documents and folders.
- **Recommendations on demand** — "Get a recommendation for this machine" in the Models view
  re-runs the onboarding matchmaker any time, using your measured speeds.

## v0.6.0 — Agent trust

- **Diff previews for file writes** — when a tool wants to write, edit or move a file, the
  permission modal shows a real diff against the file's current content (+adds/−removes, new-file
  detection, mismatch warnings), with raw arguments one click away. Approve what will actually
  happen, not JSON.
- **Relevance-triggered skills** — every skill is now Off, Auto or Always. Auto skills activate
  only when a message matches their triggers (editable per skill), keeping small contexts lean;
  each reply notes which skills applied. Changing the active skill set mid-chat no longer resets
  the model's memory of the conversation.
- **Artifacts pane** — HTML, SVG and Markdown outputs open in a side panel (sandboxed, no access
  to the app) instead of scrolling past as code blocks; reopen any artifact from a chip under the
  message.

## v0.5.0 — Documents & daily polish

- **Attach files to chat** — drop or pick text, markdown, code and PDF files; contents go to the
  model with honest token metering on every chip. Attachments persist with the chat and replay on
  resume, so a reloaded conversation still knows its documents.
- **Chat with a folder** — attach a whole folder from the composer: PowerStation indexes it with a
  small local embedding model (downloaded once, ~84 MB, fully offline afterwards) and retrieves the
  most relevant passages per question, with sources shown under each answer.
- **Regenerate & edit** — re-roll the last answer, or pull your last message back into the composer
  to fix and resend.
- **Live context meter** — the chat header shows how much of the model's context window the
  conversation actually occupies.
- **Chat search & export** — search across all saved chats from the sidebar; export any chat as
  Markdown.
- **"What's new" card** — after an update, one dismissible line tells you the version changed.

## v0.4.0

- Weekly catalogue-freshness CI verifying every model URL, file size and connector package.
- Starter prompt chips on the empty-chat welcome.
- Ollama detection: import models you already have in Ollama with one click — no re-download.
- MLX engine pack: full engineering design published (staged after signing).

## v0.3.0

- Real skills: markdown instruction packs with five starters, in-app editing and token metering.
- One-click connector gallery: six curated, npm-verified MCP servers.
- MCP servers run with their working directory in the app's data folder.

## v0.2.0

- On-device speed benchmark: measured tokens/sec on your machine, on every card.
- Conversation persistence with model-side history replay.
- Runtime upgrade fixing "Failed to load model" for newer architectures (Gemma 4).

## v0.1.0 — Full redesign

- Scan-and-reveal onboarding, verified model catalogue, pre-load admission control,
  crash-isolated runtime, MCP agent harness with permissions, capability gating,
  memory-pressure auto-pause, honest monitoring. macOS Apple Silicon + Windows x64 (beta).
