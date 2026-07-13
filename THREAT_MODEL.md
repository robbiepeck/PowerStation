# Threat model

This document describes PowerStation's security assumptions, principal attack surfaces, controls,
and residual risks. It should be updated whenever the application gains a new source of untrusted
input or a new side-effecting capability.

## Scope and assets

PowerStation is a local desktop application that loads model files, processes user documents, and
can invoke tools through MCP servers. Assets that require protection include:

- user files accessible to configured tools;
- chats, attachments, indexes, projects, agents, skills, schedules, and backups;
- tool permissions, API tokens, and other application settings;
- host availability, memory, storage, and compute resources;
- the integrity of downloaded models, catalogues, and application updates.

## Trust zones

| Zone | Trust level | Responsibilities |
| --- | --- | --- |
| React renderer | Untrusted presentation layer | Displays content and requests allowlisted operations through preload. |
| Preload bridge | Narrow trusted interface | Exposes a fixed IPC surface; does not provide general Node.js access. |
| Electron main process | Trusted policy boundary | Validates input, persists data, enforces permissions, and manages external processes. |
| Inference utility process | Isolated native workload | Loads GGUF models and performs generation; may crash without terminating the UI. |
| MCP servers | User-trusted external programs | Run with the user's OS permissions and may access network or filesystem resources. |
| Models, documents, tool output, and catalogues | Untrusted data | May be malformed, adversarial, or contain prompt injection. |

## Security assumptions

- The operating system and signed-in user account are not already compromised.
- Users protect their account and application data with appropriate OS security controls.
- Users install MCP servers and imported models only from sources they are prepared to trust.
- Loop limits and permission prompts reduce the impact of model mistakes; they do not establish
  that model output is correct or safe.
- A persistent **Always allow** decision deliberately grants more authority and weakens interactive
  protection for that tool.

## Threats and mitigations

### Prompt injection through documents or tool output

A file, retrieved page, or tool response may instruct the model to ignore user intent, disclose
data, or invoke a dangerous tool.

Controls:

- tool output is capped and explicitly framed as untrusted data;
- side-effecting calls remain subject to permission policy;
- file mutations include a change preview;
- call budgets and repeated-call detection limit automated retries;
- tool decisions and outcomes are recorded in the chat audit log.

Residual risk: a model can still produce misleading output or request an unsafe operation. A user
who has granted persistent permission to a powerful tool may not receive another prompt.

### Malicious or compromised MCP server

An MCP server may read accessible data, execute harmful operations, or communicate externally.

Controls:

- servers are spawned by the main process over stdio and are not exposed to the renderer;
- model invocation of each discovered tool is controlled by per-tool permissions;
- curated connector metadata and arguments are validated before launch.

Residual risk: the server process itself runs with the current user's permissions. PowerStation
cannot sandbox or attest arbitrary third-party servers. This is the largest intentional extension
of the application's local trust boundary.

### Malformed or malicious model file

A crafted GGUF may crash the native runtime or exploit a defect in the model loader.

Controls:

- inference runs in a separate utility process;
- worker failure rejects active requests and presents a recoverable UI state;
- repeated crash-on-load attempts are rate-limited;
- catalogue downloads are restricted to validated Hugging Face URLs.

Residual risk: native parser vulnerabilities may still affect the host process environment. Users
are responsible for the provenance of imported models.

### Resource exhaustion

A model, context, tool loop, or scheduled job may exhaust memory, storage, CPU, or battery.

Controls:

- admission control estimates model weights, KV cache, and compute buffers before loading;
- context is reduced or a load is refused when it does not fit;
- memory-pressure monitoring can pause generation;
- tool calls have per-turn budgets and repeated-call limits;
- scheduled jobs are serialized and bounded by context, token, and time limits.

Residual risk: estimates and platform telemetry are imperfect, particularly with imported models
or heterogeneous GPU backends. Native runtimes may fail despite a successful estimate.

### Renderer compromise or injected web content

Rendered content may attempt to access Node.js, navigate to hostile origins, or invoke privileged
application operations.

Controls:

- `contextIsolation`, renderer sandboxing, and `nodeIntegration: false`;
- a fixed preload API rather than general IPC access;
- navigation away from the bundled application is blocked;
- external link handling is allowlisted and validated;
- rendered artifacts are sandboxed from the application.

Residual risk: a vulnerability in Electron, Chromium, or an exposed IPC handler may cross the
boundary. Electron and dependencies should be kept current.

### Download and catalogue supply chain

A compromised upstream service or dependency may provide malicious data or native code.

Controls:

- catalogue and model downloads use HTTPS and approved hosts;
- remote catalogue fields and download URLs are validated before use;
- a bundled catalogue is available as an offline fallback;
- locked npm dependencies are used for reproducible installs;
- catalogue targets are checked by scheduled CI.

Residual risk: the project ultimately trusts GitHub, Hugging Face, npm, and the dependency supply
chain. HTTPS and schema validation do not establish that an upstream artifact is benign.

### Local API misuse

Another local process may attempt to consume inference capacity or access the local API without the
user's knowledge.

Controls:

- the API is disabled by default and binds only to `127.0.0.1`;
- every request requires a generated bearer token;
- regenerating the token immediately revokes the previous value;
- requests are logged and pass normal admission control.

Residual risk: malware or another process running as the same user may be able to read application
memory or configuration. Users who place a reverse proxy in front of the API assume responsibility
for remote authentication, encryption, and rate limiting.

### Data at rest and backup disclosure

Anyone with access to the user account or an exported backup may read stored content.

Controls:

- data locations are documented and revealable;
- chat persistence can be disabled and stored chats can be deleted;
- privacy-safe diagnostics exclude content, identifiers, secrets, and user paths;
- scheduled result history and model weights are omitted from normal backups.

Residual risk: application data is stored in readable local files and relies on OS account controls
and disk encryption. Backups must be protected by the user.

### Repair and cleanup operations

Cleanup functionality could delete unintended files or be manipulated through path traversal or
symlinks.

Controls:

- external locations are inspection-only;
- deletions accept fixed item identifiers rather than arbitrary paths;
- the main process resolves targets from an allowlist;
- `realpath` containment checks prevent traversal and symlink escape;
- cleanup is restricted to rebuildable PowerStation-owned data and recorded in `repair-log.json`;
- model-initiated cleanup uses the same permission, preview, and audit path as MCP tools.

Residual risk: approved cleanup permanently removes the described app-owned data. Users should
review the preview before proceeding.

## Out of scope

- a compromised operating system, administrator account, or physical session;
- correctness, safety, or availability guarantees for third-party models and MCP servers;
- remote deployment of the localhost API behind user-managed infrastructure;
- protection against a user intentionally granting broad authority to untrusted software.

## Reporting and maintenance

Report suspected vulnerabilities through the private process in [Security](SECURITY.md). Update
this threat model when adding new IPC methods, model formats, network destinations, tool classes,
data stores, or execution engines.
