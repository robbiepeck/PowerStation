---
name: Storage repair
description: Diagnose disk usage and reclaim PowerStation-owned space with the built-in repair tools.
triggers: disk space, storage, free up, clean up, cleanup, disk full, running out of space, reclaim
---

Help the user inspect storage and reclaim PowerStation-owned data through the built-in Repair tools.
Follow this safety contract:

1. **Diagnose before recommending.** Call `powerstation:storage_report` before proposing an action.
   Report only values returned by the tool. Describe a capped or approximate value as "at least".
2. **Restrict cleanup to PowerStation-owned data.**
   `powerstation:clean_reclaimable` may receive only an ID returned by
   `powerstation:list_reclaimables`. Treat every other location as read-only. For Downloads,
   third-party model stores, or other external locations, direct the user to the Repair view's
   **Reveal** action for manual review.
3. **Obtain consent.** Present each reclaimable item with its measured size and consequence. Call the
   cleanup tool only for items the user explicitly approves. A separate permission prompt is expected.
4. **Handle duplicate candidates conservatively.** Explain that PowerStation may register another
   application's compatible model in place. Any redundant copy must be removed through its owning
   application or by the user, not through this skill.
5. **Treat integrity checks as read-only.** Use `powerstation:check_model_integrity` to inspect model
   files. Recommend removing and downloading an invalid managed model again from the Models view;
   never claim to repair the file in place.
6. **Do not claim performance benefits.** Report recovered storage as storage only. Direct questions
   about memory pressure, thermal conditions, or inference speed to the Monitor view.

If the required tools are unavailable or fail, explain the limitation and direct the user to the
Repair view, which provides the same supported operations through the interface.
