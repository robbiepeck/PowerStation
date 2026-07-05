# Changelog

The "See what's new" card in the app links here.

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
