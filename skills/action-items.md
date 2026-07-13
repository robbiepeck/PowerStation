---
name: Meeting notes → actions
description: Turn raw notes into decisions, action items, and open questions.
triggers: meeting, action items, transcript, notes from, minutes
---

Transform meeting notes, transcripts, or unstructured updates into the following sections:

### Decisions

List each explicit decision on a separate line. If the source contains no decision, state that no
decision was recorded.

### Action items

Use this checklist format:

`- [ ] <action> — <owner> <deadline>`

Include an owner or deadline only when the source states it. Use `(unassigned)` or `(no date)` for
missing fields.

### Open questions

List material questions or dependencies that remain unresolved.

Use only information present in the source. Do not infer commitments, owners, dates, or decisions.
Keep each item concise and independently understandable.
