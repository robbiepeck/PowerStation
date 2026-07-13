# Security policy

PowerStation runs models and user-configured tools on a local computer. Security reports are taken
seriously, particularly when they involve tool permissions, path containment, model or catalogue
validation, IPC boundaries, backup restoration, or unintended network access.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include the affected version or commit, operating system, reproduction steps, expected behaviour,
   observed behaviour, and potential impact.

If private vulnerability reporting is unavailable, contact the maintainer through the contact
details on the GitHub profile and request a private reporting channel. Do not include exploit details
in the initial public message.

You should receive an acknowledgement within seven days. Timing for validation and remediation
depends on severity and reproducibility. Please allow a reasonable remediation window before public
disclosure.

## Supported versions

PowerStation is beta software and currently supports the latest tagged release and the current
`main` branch. Security fixes are not routinely backported to older releases.

| Version | Security support |
| --- | --- |
| Latest tagged release | Supported |
| Current `main` branch | Supported for development reports |
| Older releases | Update before reporting unless the issue is known to persist |

## Security boundaries

PowerStation uses the following core controls:

- The React renderer runs with `contextIsolation`, sandboxing, and no Node.js integration.
- A narrow preload allowlist exposes typed operations to the renderer.
- Native model inference runs in a separate Electron utility process.
- Remote catalogue data is validated before use, and model downloads are restricted to approved
  Hugging Face URLs.
- New tools require confirmation by default; persistent allow/deny choices are scoped per tool.
- File mutations show a preview, and all tool decisions and outcomes are audit-logged.
- Built-in cleanup operations resolve fixed identifiers in the main process and enforce real-path
  containment within PowerStation-owned data.
- The optional API server is disabled by default, bound to `127.0.0.1`, and protected by a generated
  bearer token.

These controls reduce risk but do not make untrusted models, documents, or MCP servers safe by
themselves. Review the [threat model](THREAT_MODEL.md) for assumptions and residual risks.

## Data and network behaviour

By default, model inference, chats, attachments, folder indexes, projects, agents, skills, and
schedules are stored and processed locally. PowerStation makes network requests for:

- model downloads from Hugging Face;
- catalogue updates and release checks from GitHub;
- network-enabled MCP connectors explicitly configured and invoked by the user.

Custom MCP servers are separate programs that run with the current user's operating-system
permissions. Their behaviour is outside PowerStation's security boundary. Install only servers you
trust and grant each tool the minimum authority required.

Application data is not independently encrypted at rest. It relies on operating-system account
security and full-disk encryption such as FileVault or BitLocker. Backups may contain chats,
settings, permissions, skills, projects, agents, and scheduled-job definitions; protect them as
sensitive files.

## Security-related contributions

Changes that affect the renderer boundary, IPC, file access, process execution, tool permissions,
catalogue validation, backup parsing, API authentication, or cleanup containment should include:

- tests for malformed and adversarial input;
- a description of the trust boundary being changed;
- documentation updates when user expectations or residual risks change.

See [Contributing](CONTRIBUTING.md) for the general development workflow.
