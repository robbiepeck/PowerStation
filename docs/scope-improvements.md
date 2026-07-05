# Scope improvements

Items discussed in the original product critique that were deferred for scope, tracked here as the
working backlog. Each entry notes where it came from, what it takes, and its status. The high-level
direction lives in the [Roadmap](../ROADMAP.md); this page is the detailed version.

| # | Item | Origin | Effort | Status |
| --- | --- | --- | --- | --- |
| 1 | Real skills & connector gallery | Original goal #2 | Medium | Planned — next up |
| 2 | On-device speed micro-benchmark | Critique recommendation | Small | **Shipped v0.2** |
| 3 | Conversation persistence | Roadmap / daily-use gap | Medium | **Shipped v0.2** |
| 4 | Catalogue freshness CI | Critique: "stale catalogue is fatal" | Small | Planned |
| 5 | First-run demo moment | UX critique | Small | Planned |
| 6 | Storage cleanup as an agent skill | Cut feature, approved return path | Medium | Optional — needs decision |
| 7 | Ollama as detected optional backend | Critique runtime recommendation | Medium | Planned |
| 8 | MLX engine pack (Apple Silicon) | Critique performance chapter | Large | Later |
| 9 | Web-based recommender funnel | Product critique | Small–medium | Later |
| 10 | Signing & notarization (macOS + Windows) | Critique pre-release prerequisite | Small (needs credentials) | **Blocked on accounts** |

## The items in detail

### 1. Real skills & connectors — *planned, next up*
The Utilities panel currently stores skills and connectors as labels only. Build the real thing:
skills as local folders of instructions injected into the system prompt when relevant, and a
**connector gallery** — curated one-click MCP servers (filesystem, web fetch, memory, search)
instead of pasted `npx` commands. This completes original goal #2 ("easily connecting up skills,
connectors") and is the largest remaining gap between vision and app.

### 2. On-device speed micro-benchmark — *shipped v0.2*
After a model is set up, run a short standard generation and record **measured tokens/sec on this
exact machine**, shown on model cards and in recommendations instead of hand-curated estimates.
The competitive research found no other local-AI app does this; it makes every speed claim
verifiable. Runs automatically after a catalogue download and on demand per model.

### 3. Conversation persistence — *shipped v0.2*
Chats survive restarts: a sidebar of recent conversations, stored as plain JSON files in the app's
user-data folder (revealable in Finder/Explorer — goal #4 transparency), with a Settings toggle,
"delete all", and model-side history replay so a resumed chat actually remembers its context.

### 4. Catalogue freshness CI — *planned*
A scheduled weekly GitHub Action that re-verifies every Hugging Face URL in
[`catalog/models.json`](../catalog/models.json) and opens an issue when a link breaks or an entry
goes stale. Directly addresses the critique's core warning (the GPT4All cautionary tale: a stale
catalogue kills a recommendation product).

### 5. First-run demo moment — *planned*
After the first model loads, offer 2–3 curated starter prompts the model demonstrably nails
(summarise, rewrite, extract) so the first impression is competence — not a frontier-grade question
it fumbles. Finishes the onboarding story from the UX critique.

### 6. Storage cleanup as an agent skill — *optional, needs a decision*
The original storage-cleanup/repair-agent concept was cut from core scope, with the approved return
path being an **agent skill**: the model proposes cleanups and every action runs through the
allow/ask/deny permission flow. Only worth building if it's still wanted — it remains off-vision
for the core product.

### 7. Ollama as a detected optional backend — *planned*
Detect a running Ollama (`localhost:11434/api/version`) and offer its models as an optional
backend — never a dependency. Useful for people with existing Ollama libraries.

### 8. MLX engine pack — *later*
Research showed MLX runs 1.2–3× faster than llama.cpp on Apple Silicon. Ship it as an optional
engine subprocess (LM Studio's multi-runtime pattern). Real speed win; real maintenance surface
(bundles a Python runtime, Apple-only).

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
