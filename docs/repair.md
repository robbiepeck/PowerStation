# Repair — storage & health, without the snake oil

The "Mac cleaner" category earned its bad reputation by deleting things it didn't understand.
PowerStation's Repair tab is built on the opposite premise, stated in the UI and enforced in code:

> **PowerStation never deletes, moves, or edits anything outside its own data folder.**
> Everything else is measured read-only and *revealed* — you decide, in Finder, where deletes go
> to the recoverable Trash.

## What it does

**Where the space is (read-only).** A curated list of the well-known homes of AI-related files —
Downloads, Trash, the Hugging Face cache, Ollama's blob store, LM Studio's models, and
PowerStation's own data — each measured with a bounded, symlink-ignoring walk (figures that hit
the scan cap say *at least*). The only button is **Reveal**, which opens the location in the OS
file manager. The scan list is fixed in the main process; the UI cannot ask it to scan or reveal
arbitrary paths.

**Duplicate models across apps.** The same GGUF sitting in both LM Studio and PowerStation is pure
wasted disk — PowerStation can use another app's copy in place (Models tab), so the spare is safe
to remove in that app. Detection is deliberately conservative: exact file name *and* exact size,
so two different quantizations are never called duplicates. Ollama's content-addressed blobs are
excluded rather than guessed at.

**Reclaim space in PowerStation.** The only deletes in the tab, scoped to data the app itself
created and can recreate: indexes of knowledge folders that no longer exist, the re-downloadable
embeddings model, and catalogue caches. Each item shows its exact size and consequence, asks for
confirmation, and is recorded in a removal log shown in the tab.

**Model file health (read-only).** Every local model is checked for a valid GGUF signature and a
plausible size against the catalogue — catching corrupt or incomplete downloads *before* they
crash a chat. Fixes are honest: re-download from the Models tab.

## How safety is enforced (not just promised)

- Every mutating operation resolves its target **server-side from an allowlist of ids** — the
  renderer never supplies a path — and must pass a containment guard that resolves symlinks
  (`realpath`) before checking the path sits inside the app's data folder. The guard is
  unit-tested against `..` traversal and against symlinks planted inside the data folder that
  point outside it.
- External locations are read with `stat` walks only: no shell commands, no elevation, nothing
  executed, symlinks never followed, entry counts capped.
- Every removal is appended to `repair-log.json` in the data folder — the tab shows everything it
  has ever deleted.

## Repair as an agent skill

The same toolset is available to the model through the bundled **Storage repair** skill (Utilities
→ Skills; ships off, enable to opt in). When active, the model can call
`powerstation:storage_report`, `list_reclaimables`, `clean_reclaimable`, and
`check_model_integrity` — through the **same permission prompts, previews, and audit log** as any
MCP tool. The one mutating tool resolves its target through the same id allowlist and containment
guard as the tab's buttons, so the model cannot express an out-of-contract delete no matter what
it generates; the approval dialog shows exactly what would be removed and the consequence. The
skill's instructions bind it to this page's contract: diagnose first, report real numbers only,
propose and wait for consent, and never suggest deleting anything PowerStation didn't create.

## What Repair will never do

- Delete or edit system files, caches, or anything in `~/Library` beyond PowerStation's own folder.
- Change plists, permissions, daemons, or startup items; run elevated commands.
- Claim to "speed up your Mac". The Monitor tab shows the real signals, labelled measured or
  estimated; the honest speed fix on a memory-tight machine is a smaller model, and the app says so.

*Related: [Memory & monitoring](memory-and-monitoring.md) · [Threat model](../THREAT_MODEL.md).*
