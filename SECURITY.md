# Security

PowerStation is a local-first app whose entire pitch is "your machine, your data." This page covers
what that means in practice and how to report a vulnerability. For the deeper analysis of the agent
attack surface, see the [Threat model](THREAT_MODEL.md).

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Instead, use GitHub's private
[**Report a vulnerability**](https://github.com/robbiepeck/PowerStation/security/advisories/new)
flow on this repository. Include steps to reproduce, affected version/commit, and impact. You'll get
an acknowledgement and a fix timeline; please allow reasonable time to remediate before any public
disclosure.

## What runs, and what leaves your machine

- **Inference is local.** Models run on-device via a bundled `node-llama-cpp` runtime. Prompts and
  responses are never sent anywhere.
- **Chats stay on your machine.** Conversations are saved as plain JSON files in the app's
  user-data folder — never transmitted. Saving can be disabled in Settings, and files can be
  revealed or deleted there at any time.
- **Network is minimal and pinned.** The only outbound traffic is: model downloads and catalogue
  updates from `huggingface.co` / this GitHub repo (download URLs are validated and pinned to
  `huggingface.co`), and update checks against this repo's GitHub Releases. External-link opening is
  allowlisted to Hugging Face and this repository's paths.

## The renderer is sandboxed

The UI runs with `contextIsolation`, `sandbox`, and `nodeIntegration: false`. It has no direct access
to Node, the filesystem, or the model runtime — only a small, typed API exposed through a preload
`contextBridge` allowlist. It cannot invent new IPC channels or reach the OS directly.

## The agent surface is the real attack surface

An agent that can run tools on your machine is more powerful — and more dangerous — than a chat box,
and small local models are more susceptible to prompt injection than frontier models. PowerStation's
mitigations:

- **Every tool call is gated** by an allow / ask / deny permission model; side-effecting tools default
  to asking.
- **Tool output is treated as untrusted data** — capped in size, framed to the model as data rather
  than instructions, and never executed.
- **Capability gating** keeps tools off models that can't use them reliably.
- **MCP servers run in the main process over stdio**, never reachable from the renderer.
- **Loop guards** stop runaway or repeated tool calls.

The full analysis — assets, trust boundaries, threats and residual risk — is in the
[Threat model](THREAT_MODEL.md).

## Scheduled jobs

Scheduled jobs execute without a person present, so their authority is intentionally narrower than
chat. They receive only the saved prompt and optional system instructions; no MCP tools, built-in
tools, skills, retrieval context, API credentials, or shell are attached. Jobs cannot change their
own schedule or permissions. Model presence, fit, overlap, battery state, memory pressure, response
size, and runtime are bounded before or during every run. Notifications never contain generated
text. Definitions and results remain in the private local schedule store and are visible in the run
ledger.

## Your responsibilities

- **MCP servers run with your permissions.** Only add servers you trust, and only grant "always allow"
  to tools you understand. A malicious or careless server is outside PowerStation's control.
- **Model licences and provenance.** You are responsible for reviewing and complying with each model's
  licence, and for the trustworthiness of any model you import yourself.

## Supported versions

PowerStation is pre-1.0; security fixes target the latest `main`. Please test against the current
`main` before reporting.
