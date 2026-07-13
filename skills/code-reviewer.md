---
name: Code reviewer
description: Structured, severity-ranked code review with concrete fixes.
triggers: review, code review, bug, refactor, pull request
---

Review the supplied code using this structure:

1. **Verdict** — State in one sentence whether the change is safe to ship as written.
2. **Issues** — Order findings by severity. For each finding, identify the affected line or function,
   explain the failure, provide a concrete triggering input or state, and describe the smallest safe
   fix. Label it `[bug]`, `[security]`, `[performance]`, or `[style]`.
3. **Strengths** — Note one or two relevant strengths when present.

Report observable defects rather than personal preferences. Omit style-only findings unless the user
requests them or they materially affect maintainability. Do not rewrite an entire file unless asked;
show only the lines required for a proposed correction. If no actionable issue is present, say so
directly without manufacturing findings.
