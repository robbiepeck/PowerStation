# Scope improvements

Items discussed in the original product critique that were deferred for scope, tracked here as the
working backlog. Each entry notes where it came from, what it takes, and its status. The high-level
direction lives in the [Roadmap](../ROADMAP.md); this page is the detailed version.

| # | Item | Origin | Effort | Status |
| --- | --- | --- | --- | --- |
| 1 | Real skills & connector gallery | Original goal #2 | Medium | **Shipped v0.3** |
| 2 | On-device speed micro-benchmark | Critique recommendation | Small | **Shipped v0.2** |
| 3 | Conversation persistence | Roadmap / daily-use gap | Medium | **Shipped v0.2** |
| 4 | Catalogue freshness CI | Critique: "stale catalogue is fatal" | Small | **Shipped v0.4** |
| 5 | First-run demo moment | UX critique | Small | **Shipped v0.4** |
| 6 | Storage cleanup / repair (tab + agent skill) | Cut feature, approved return path | Medium | **Shipped v0.12 + v0.14** |
| 7 | Ollama as detected optional backend | Critique runtime recommendation | Medium | **Shipped v0.4** (model import) |
| 8 | MLX engine pack (Apple Silicon) | Critique performance chapter | Large | **Designed** — [plan](mlx-engine-plan.md), staged after signing |
| 9 | Web-based recommender funnel | Product critique | Small–medium | Later |
| 10 | Signing & notarization (macOS + Windows) | Critique pre-release prerequisite | Small (needs credentials) | **Blocked on accounts** |

## The items in detail

### 1. Real skills & connectors — *shipped v0.3*
Skills are real: markdown files in the data folder, seeded with five starters, editable in-app,
token-metered, and injected into the system prompt while enabled (they work on every model,
including chat-only ones). The **connector gallery** offers six curated, npm-verified MCP servers —
local files (folder-picker scoped), memory, web reading, web search, sequential thinking, and a
demo server — added with one click and remotely updatable via `catalog/connectors.json`. Completes
original goal #2. The relevance-triggered upgrade shipped in v0.6 (Off/Auto/Always modes with per-skill triggers).

### 2. On-device speed micro-benchmark — *shipped v0.2*
After a model is set up, run a short standard generation and record **measured tokens/sec on this
exact machine**, shown on model cards and in recommendations instead of hand-curated estimates.
The competitive research found no other local-AI app does this; it makes every speed claim
verifiable. Runs automatically after a catalogue download and on demand per model.

### 3. Conversation persistence — *shipped v0.2*
Chats survive restarts: a sidebar of recent conversations, stored as plain JSON files in the app's
user-data folder (revealable in the OS file manager — goal #4 transparency), with a Settings toggle,
"delete all", and model-side history replay so a resumed chat actually remembers its context.

### 4. Catalogue freshness CI — *shipped v0.4*
A weekly GitHub Action (plus on every catalogue edit) re-verifies every Hugging Face URL — and the
advertised file sizes — in `catalog/models.json`, and every npm package in
`catalog/connectors.json`, opening/updating an issue on failure. Addresses the critique's core
warning (a stale catalogue kills a recommendation product).

### 5. First-run demo moment — *shipped v0.4*
The empty-chat welcome offers four curated starter chips (tiny poem, explain-like-I'm-ten, dinner
ideas, tone rewrite) chosen to be squarely within small-model competence, so the first impression
is what the model does well. One click sends the prompt.

### 6. Storage cleanup / repair — *shipped: tab in v0.12, agent skill in v0.14*
Robbie called it back into scope (2026-07-06), in a deliberately narrow form: a deterministic
**Repair tab** built on a hard contract — read-only diagnostics for anything PowerStation didn't
create (reveal-in-Finder only), deletes scoped strictly to the app's own data behind a
symlink-resolving containment guard, model-file integrity checks, and an explicit "won't do"
list. v0.14 added the **agent-skill variant**: an opt-in bundled skill whose built-in tools ride
the same permission/preview/audit rails and the same delete allowlist, so the model can diagnose
and (with consent) reclaim app-owned space but cannot express an out-of-contract delete. See
[repair.md](repair.md). General device-repair stays out.

### 7. Ollama as a detected optional backend — *shipped v0.4 (model import)*
PowerStation detects Ollama (daemon or install) and lists its models by reading the manifest
store; one click registers the underlying GGUF blob as an imported model — no re-download, no
extra disk. Inference runs in PowerStation's own runtime with the same admission checks; Ollama is
never a dependency. (Chatting *through* the Ollama daemon remains out of scope.)

### 12. LM Studio import — *shipped v0.10*
The Ollama pattern applied to the other big model manager: PowerStation walks
`~/.lmstudio/models` (and the pre-0.3 cache location), lists the GGUFs it finds, and one click
registers a file in place — no re-download, no extra disk, same admission checks. Split GGUF
series are priced as the whole set, which is what actually loads.

### 13. Chat pin & rename — *shipped v0.10*
Pin chats to the top of the sidebar; rename inline. A renamed title is locked (saves stop
re-deriving it from the first message); clearing the name unlocks it again.

### 14. Turn-scoped tool approval — *shipped v0.10*
"Allow rest of turn" in the permission dialog: one approval covers the model's remaining
ask-gated calls in the current reply. Reduces prompt fatigue on multi-step tasks without touching
standing permissions — the grant expires with the turn and every call is still audit-logged.

### 15. Battery & energy awareness — *shipped v0.10*
Battery state in the monitor and telemetry; a status-pill nudge below 25% on battery (lighter
models draw less power); an estimated per-chat watt-hours figure in the chat header, labelled as
the ballpark it is (the power reading is itself an estimate).

### 16. Projects (workspaces) — *shipped v0.11*
The sidebar switcher bundles per-context setup: instructions appended to the system prompt, a
knowledge folder auto-attached to new chats, per-project skill-mode overrides, a connector
selection that scopes which MCP servers run, and a preferred model. Chats are stamped with their
project; Personal shows unassigned history. One JSON file per project, next to the chats. See
[projects.md](projects.md).

### 17. Backup & restore — *shipped v0.11*
One readable JSON archive (settings, tool permissions, benchmarks, skills, chats, projects) from
Settings; restore replaces settings/permissions, overwrites same-id content, and passes everything
through the same sanitizers as a normal config read. Model weights stay out by design.

### 18. Multi-model compare — *shipped v0.13*
One prompt, two models, measured side by side with "use this model" on the winner. Sequential by
design (one model in memory at a time → fair timings, no memory gamble); each side goes through
normal admission and can honestly refuse.

### 19. Agent trust profiles — *shipped v0.13*
Trusted (remembered allows apply) vs Cautious (every call asks; remembered allows suspended, not
deleted; allow-rest-of-turn still works; denies still block). Chat-header chip when cautious.

### 20. Recommendation "why this over that" — *shipped v0.13*
Alternates explain themselves against the top pick on fit, measured/likely speed, capacity, and
tool tier — honest in both directions. Pure `explainVersusPrimary`, unit-tested.

### 21. Custom agents (M365-style) — *shipped v0.15, extended v0.16*
Robbie's ask, modelled on the Microsoft 365 agent builder and scoped via explicit product
decisions: agents are a **separate concept from projects** (an assistant you summon per chat vs a
workspace you switch into), invoked by **Start chat** from the Agents tab, configured with
**instructions + up to eight knowledge folders**, and chats carry a **badge** that survives agent
deletion. Multi-folder retrieval merges chunks across folders with folder-prefixed citations. See
[agents.md](agents.md).

### 22. Agent export/import — *shipped v0.16*
An agent is one JSON file; **Export…** writes a versioned `*.agent.json`, **Import** reads one back
under a fresh id (never overwriting). Knowledge/connector references travel and degrade gracefully
where they don't resolve. Pure share format, unit-tested.

### 23. Agent connectors — *shipped v0.16*
Agents can name the MCP servers they may use (the one thing deliberately left out of v0.15). An
in-memory active-agent id drives reconcile precedence: agent → project → global; empty inherits
rather than silencing. Tool calls stay permission-gated.

### 24. Agent plan preview — *shipped v0.16*
Opt-in (Settings → Agent trust). A tool-capable model proposes a turn's steps via an isolated
planning pass (snapshots/restores the session so the conversation is untouched); approving runs the
whole turn with tools pre-authorized, cancelling runs nothing. Reuses the turn-scoped grant and the
audit log.

### 25. Local API server — *shipped v0.18*
Robbie's idea: expose the running model as an OpenAI-compatible HTTP endpoint so other local apps
and scripts can call it. Confirmed design: token-required auth, honour the requested model (fall
back to selected), raw inference (no app prompt/skills), inference-only (no tools) for v1. Bound to
127.0.0.1, off by default, serialized through the single worker, admission-controlled per request,
with a request log. Zero new deps (node:http). See [api-server.md](api-server.md).

### 11. Vision models — *groundwork shipped, runtime-blocked (2026-07-06)*
Verified: the catalogue's Gemma 4 models have real ~1 GB mmproj vision files on Hugging Face
(schema + data + weekly CI verification shipped, plus an honest "vision-capable model" badge) —
but `node-llama-cpp` 3.19.0, the newest release, exposes no multimodal API, and no server binary
ships to shell out to. Full gap analysis and the two delivery paths in
[vision-plan.md](vision-plan.md); a freshness-CI watchdog flags every new runtime release so the
unblock is evaluated the week it lands. No vision UI ships until the runtime runs it.

### 8. MLX engine pack — *designed, staged after signing*
Research showed MLX runs 1.2–3× faster than llama.cpp on Apple Silicon. The full engineering plan
— engine registry, managed Python subprocess, parallel MLX catalogue variants, per-engine
benchmarks — lives in [mlx-engine-plan.md](mlx-engine-plan.md). Deliberately staged after
signing/notarization rather than half-shipped.

### 9. Web-based recommender funnel — *later*
The onboarding questionnaire as a free static web page (same catalogue JSON, browser-detectable
hints) that funnels visitors to the app download. Marketing surface more than product.

### 10. Signing & notarization — *release gates wired, blocked on accounts*
The release path now refuses to publish tagged macOS builds unless Developer ID signing succeeds,
and tagged Windows builds unless code signing succeeds. The packaging config is ready for macOS
Developer ID + notarization credentials and Windows certificate secrets; public distribution still
needs those accounts/certificates, and Windows SmartScreen reputation still has to accrue from
signed releases.

## Still excluded, by decision

- **Cloud fallback (BYOK)** — strictly-local was an explicit product decision; stays out unless
  that decision changes.
- **Fine-tuning** — from the earliest project notes; heavy scope, niche audience, and the product's
  wedge is elsewhere. Consciously not planned.
- **Additional Linux package formats** — AppImage and deb are the supported beta artifacts; rpm,
  tarballs, and distro-specific packaging stay demand-driven.
