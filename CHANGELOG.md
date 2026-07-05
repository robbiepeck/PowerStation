# Changelog

The "See what's new" card in the app links here.

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
