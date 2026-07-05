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
| 6 | Storage cleanup as an agent skill | Cut feature, approved return path | Medium | Optional — needs decision |
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
original goal #2. Future upgrade path: relevance-triggered skill injection instead of always-on.

### 2. On-device speed micro-benchmark — *shipped v0.2*
After a model is set up, run a short standard generation and record **measured tokens/sec on this
exact machine**, shown on model cards and in recommendations instead of hand-curated estimates.
The competitive research found no other local-AI app does this; it makes every speed claim
verifiable. Runs automatically after a catalogue download and on demand per model.

### 3. Conversation persistence — *shipped v0.2*
Chats survive restarts: a sidebar of recent conversations, stored as plain JSON files in the app's
user-data folder (revealable in Finder/Explorer — goal #4 transparency), with a Settings toggle,
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

### 6. Storage cleanup as an agent skill — *optional, needs a decision*
The original storage-cleanup/repair-agent concept was cut from core scope, with the approved return
path being an **agent skill**: the model proposes cleanups and every action runs through the
allow/ask/deny permission flow. Only worth building if it's still wanted — it remains off-vision
for the core product.

### 7. Ollama as a detected optional backend — *shipped v0.4 (model import)*
PowerStation detects Ollama (daemon or install) and lists its models by reading the manifest
store; one click registers the underlying GGUF blob as an imported model — no re-download, no
extra disk. Inference runs in PowerStation's own runtime with the same admission checks; Ollama is
never a dependency. (Chatting *through* the Ollama daemon remains out of scope.)

### 8. MLX engine pack — *designed, staged after signing*
Research showed MLX runs 1.2–3× faster than llama.cpp on Apple Silicon. The full engineering plan
— engine registry, managed Python subprocess, parallel MLX catalogue variants, per-engine
benchmarks — lives in [mlx-engine-plan.md](mlx-engine-plan.md). Deliberately staged after
signing/notarization rather than half-shipped.

### 9. Web-based recommender funnel — *later*
The onboarding questionnaire as a free static web page (same catalogue JSON, browser-detectable
hints) that funnels visitors to the app download. Marketing surface more than product.

### 10. Signing & notarization — *blocked on accounts*
The one item code can't solve: needs an Apple Developer account (~US$99/yr) and a Windows
code-signing certificate. Once credentials exist, CI is wired to sign every release automatically.
Gates public distribution more than any feature.

## Still excluded, by decision

- **Cloud fallback (BYOK)** — strictly-local was an explicit product decision; stays out unless
  that decision changes.
- **Fine-tuning** — from the earliest project notes; heavy scope, niche audience, and the product's
  wedge is elsewhere. Consciously not planned.
- **Linux** — next platform after Windows stabilises (see [Roadmap](../ROADMAP.md)).
