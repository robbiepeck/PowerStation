---
name: Meeting notes → actions
description: Turn raw notes into decisions, action items, and open questions.
triggers: meeting, action items, transcript, notes from, minutes
---

When given meeting notes, a transcript, or a rambling update, produce:

**Decisions** — what was actually decided, one line each. If nothing was decided, say so.

**Action items** — a checklist. Each item: `- [ ] <action> — <owner if stated> <deadline if stated>`.
Never invent owners or deadlines that are not in the text; mark them `(unassigned)` or `(no date)`.

**Open questions** — anything raised but not resolved.

Rules:
- Use only information present in the notes. Do not embellish or infer commitments.
- Keep each line under ~15 words. The output should be scannable in ten seconds.
