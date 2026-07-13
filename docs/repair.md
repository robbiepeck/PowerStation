# Repair and storage health

The Repair view reports storage use, identifies conservative duplicate candidates, checks model
integrity, and removes selected rebuildable PowerStation data. Its enforced boundary is:

> PowerStation does not delete, move, or edit data outside its own user-data directory.

External locations are inspected read-only and can be revealed in the operating-system file manager
for manual review.

## Storage inspection

Repair measures a fixed set of common AI storage locations, including Downloads, Trash, the Hugging
Face cache, Ollama, LM Studio, and PowerStation's own data. Scans use bounded filesystem walks, do not
follow symbolic links, and report **at least** when the entry limit is reached.

The location list is defined in the main process. The renderer cannot provide an arbitrary path to
scan or reveal.

## Duplicate candidates

PowerStation identifies possible duplicate GGUF files across supported applications using both exact
filename and exact size. This deliberately conservative rule avoids treating different quantisations
as duplicates. Content-addressed Ollama blobs are excluded when they cannot be matched safely.

A duplicate result is informational. Use the owning application's controls or the operating-system
file manager to decide which copy to remove. PowerStation can register supported external models in
place, which may avoid another download.

## Reclaimable application data

Repair can remove only selected data that PowerStation created and can recreate:

- indexes for knowledge folders that no longer exist;
- the downloadable local embedding model;
- validated catalogue caches.

Each item displays its size and consequence before confirmation. Successful removals are appended to
`repair-log.json` and displayed in the Repair view.

Managed model deletion is handled separately in the Models view because model files are large and
not treated as transient repair data.

## Model integrity checks

Repair checks local models for a valid GGUF signature and a plausible size relative to catalogue
metadata. The check is read-only and is intended to detect incomplete or corrupt downloads before
the model is loaded. Use the Models view to remove and re-download an invalid managed model.

## Enforcement controls

- Mutating operations accept an allowlisted item ID rather than a path supplied by the renderer or
  model.
- The main process resolves the target and uses `realpath` before enforcing containment inside the
  PowerStation user-data directory.
- Unit tests cover traversal and symbolic-link escape attempts.
- External scans use filesystem metadata calls only: no shell, elevation, execution, or symlink
  following.
- Every completed removal is recorded in the repair log.

## Storage repair skill

The bundled **Storage repair** skill exposes the same workflow to a compatible model. It is disabled
by default and must be enabled from **Utilities → Skills**. When active, the model may request:

- `powerstation:storage_report`;
- `powerstation:list_reclaimables`;
- `powerstation:clean_reclaimable`;
- `powerstation:check_model_integrity`.

These built-in tools use the standard permission, preview, and audit path. The mutating tool accepts
the same allowlisted identifiers as the Repair UI, so a model cannot supply an arbitrary deletion
path. The skill instructs the model to diagnose first, report measured values, propose an action,
and wait for consent.

## Explicit non-goals

Repair does not:

- delete system files, third-party caches, or files outside PowerStation's own data directory;
- change permissions, launch agents, daemons, startup items, or system configuration;
- run privileged commands;
- claim that general cache deletion will improve system performance.

See [Memory and monitoring](memory-and-monitoring.md) and the [threat model](../THREAT_MODEL.md).
