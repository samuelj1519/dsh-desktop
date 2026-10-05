# Security Policy

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md)

## Supported versions

Security fixes target the current `main` branch and the latest published release, if any. Older snapshots are not maintained separately. This early-stage project does not promise a response or remediation deadline.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/samuelj1519/dsh-desktop/security/advisories/new). Include the affected revision, operating system, Node/Electron versions, reproduction steps, expected trust boundary, and impact. Share a minimal proof of concept with redacted diagnostics. Keep credentials and real session data out of the report.

If the private reporting form is unavailable, open an issue requesting a private reporting channel without including vulnerability details. Avoid publishing exploit details in public issues before maintainers can review the report.

## Security boundaries

- Service endpoints must be explicit loopback HTTP roots. Navigation is limited to the selected origin.
- Service windows have no preload or Node bridge. All windows use sandboxing, context isolation, and disabled Node integration.
- Trusted settings IPC validates the sender, main frame, exact local URL, and payload fields.
- Disconnect and quit may stop only recorded client-owned resources. External services, persistent Homes, workspaces, and sessions must remain intact.
- dsh owns model credentials and tool permissions. The client does not copy credentials or rewrite global dsh configuration.

See [architecture](docs/design.md) and [implementation](docs/client.md) for details. Review dependency changes and keep the lockfile committed. Automatic dependency update proposals still require tests and review.
