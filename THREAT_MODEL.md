# Threat model

A plain-language threat model for PowerStation. The point of a local AI app with an agent harness is
that you can trust it with your machine and your data — this document is honest about what it defends
against, how, and what remains your responsibility. For reporting and the high-level posture, see
[Security](SECURITY.md).

## Assets we protect

- **Your data** — files, documents and anything a tool can reach; your prompts and conversations.
- **Your machine** — its stability (not swapping/crashing) and its integrity (no unauthorised writes
  or command execution).
- **Your trust** — the numbers and claims the app shows you are accurate.

## Trust boundaries

1. **Renderer ↔ main process.** The UI is untrusted-by-design: sandboxed, no Node access, limited to a
   typed IPC allowlist.
2. **Main process ↔ inference worker.** The model runtime is isolated in its own process so a native
   crash can't take down the app.
3. **App ↔ MCP servers.** Tool servers are external programs you configure; they run with your OS
   permissions and are outside the app's control once trusted.
4. **App ↔ the network.** Only Hugging Face and this GitHub repo, over HTTPS, for downloads/catalogue/
   updates.

## Threats and mitigations

### Unattended scheduled inference
A saved prompt runs while nobody is present and attempts to turn model output into an action, leak
content through a notification, exhaust resources, or replay after sleep.

- **Mitigations:** scheduled runs are inference-only and receive no tools, connectors, shell,
  retrieval, or secrets; outputs stay in a private bounded ledger; notifications contain status
  only; cadence, duration, output, overlap, battery, memory pressure, missed runs, and duplicate DST
  minutes are bounded explicitly. PowerStation installs no privileged scheduler or system cron
  entry.
- **Residual risk:** the saved prompt and generated result are sensitive local data. Anyone with
  access to the user's PowerStation data directory can read them, just as they can read saved chats.

### Prompt injection via tool output
A poisoned file, web page, or API response read by a tool tries to steer the agent (e.g. "ignore
previous instructions and delete X"). Small local models are especially susceptible.
- **Mitigations:** tool output is capped and framed to the model as *data, not instructions*, and is
  never executed; every side-effecting tool call still requires permission; loop guards limit damage
  from a call that keeps retrying. **Residual risk:** a user who has granted "always allow" to a
  powerful tool reduces these protections — grant it sparingly.

### Malicious or careless MCP server
A configured server could try to exfiltrate data or run harmful commands.
- **Mitigations:** servers run in the main process over stdio (never exposed to the renderer);
  per-tool permissions gate what the model can invoke; the app fixes PATH but doesn't grant elevated
  rights. **Residual risk:** the server itself runs with your permissions — only add servers you
  trust. This is the largest residual risk in the product and is stated plainly in-app.

### Malicious model file
A crafted GGUF could try to crash the runtime or exploit the loader.
- **Mitigations:** inference runs in an isolated process, so a crash is contained and recoverable; the
  app never executes model-provided content as code. **Residual risk:** you are responsible for the
  provenance of models you import yourself; catalogue models are verified against Hugging Face.

### Resource exhaustion (OOM / swap)
Loading a model too large for the machine could hang or crash it.
- **Mitigations:** pre-load admission control refuses or shrinks loads that won't fit (summing
  multi-part models); runtime memory-pressure monitoring auto-pauses generation; crashes yield a
  recovery card with a respawn cooldown. See [Memory & monitoring](docs/memory-and-monitoring.md).

### Compromised renderer / injected web content
If untrusted content ran in the UI, it could try to reach the OS or open malicious links.
- **Mitigations:** `contextIsolation` + `sandbox` + `nodeIntegration: false`; a preload allowlist the
  renderer can't extend; navigation is blocked away from the bundled UI; external-link opening is
  allowlisted to Hugging Face and this repo's paths (with a path boundary, so look-alike repo names
  are rejected).

### Download integrity / supply chain
A tampered download could deliver a bad model or catalogue.
- **Mitigations:** downloads and catalogue fetches are HTTPS and pinned to `huggingface.co` / this
  repo; remote catalogue JSON is strictly validated (and download URLs re-checked) before use; native
  binaries are packaged from the pinned `node-llama-cpp` dependency. **Residual risk:** trust in
  Hugging Face and the npm/dependency chain, as with any app.

### Data at rest
Config, permissions, downloaded models and saved chats live in the app's user-data directory.
- **Mitigations:** everything stays local; chats are plain, inspectable JSON files with an in-app
  off switch and delete-all. **Residual risk:** anyone with access to your user account can read
  the user-data directory (including chat contents) — standard OS-level trust applies. Files are
  not encrypted at rest beyond OS disk encryption (e.g. FileVault/BitLocker).

### Repair surface (tab and agent skill)
The Repair tab reads sizes from a curated set of well-known directories and deletes only
app-created data. The same operations are exposed to the model as built-in tools when the
Storage repair skill is enabled.
- **Mitigations:** scan and reveal targets are resolved in the main process from a fixed allowlist
  of ids — neither the renderer nor the model ever supplies a path; scans are read-only `stat`
  walks (no shell, no elevation, symlinks not followed, entry-capped); every delete must pass a
  `realpath`-based containment guard proving the target is inside the app's data directory,
  unit-tested against `..` traversal and symlink-escape attacks; all removals are logged to
  `repair-log.json`. Model-initiated calls additionally go through the standard tool-permission
  prompts and audit log, and the approval dialog states exactly what would be removed. A
  prompt-injected model can at worst *ask* to delete rebuildable app-owned data, with the user
  seeing precisely what before it runs. **Residual risk:** none identified beyond the app's
  existing write access to its own data folder.

## Out of scope

- A fully compromised host OS or user account.
- The behaviour of third-party MCP servers and self-imported models once you've chosen to trust them.
- Physical access to an unlocked machine.

## Reporting

Found a gap in this model or a concrete vulnerability? Use the private reporting flow in
[Security](SECURITY.md). This document evolves as the agent surface grows.
