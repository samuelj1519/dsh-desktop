# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

## Before starting

Search existing issues and discuss substantial behavior or architecture changes before implementation. Report reproducible bugs and feature requests with the issue templates. Use [private security reporting](SECURITY.md) for vulnerabilities.

Read [AGENTS.md](AGENTS.md) for module organization and coding conventions. Read [architecture](docs/design.md) and [client implementation](docs/client.md) before changing connection state, process ownership, IPC, or persistence.

## Local workflow

1. Use Node.js 22.12.0 or newer; use the version in `.nvmrc` to reproduce CI (`nvm use` if available).
2. Install dependencies with `npm ci`.
3. Create a focused branch, such as `fix/startup-cancellation` or `docs/connection-guide`.
4. Edit `src/` and `ui/`; generated `lib/` and `dist/` are excluded from Git.
5. Run `npm test`. For UI changes, also run `npm start` and check keyboard navigation, errors, reconnect, and quit with isolated application data.

Follow existing two-space TypeScript indentation, single quotes, semicolons, and NodeNext `.js` import paths. No formatter or linter is configured. Avoid unrelated formatting changes. Keep `package-lock.json` synchronized with dependency metadata and preserve exact dependency versions when updating them.

## Tests and validation

Use Node's `node:test` and `node:assert/strict`. Put behavior tests in `test/*.test.mjs` and service fixtures in `test/fixtures/`. Tests import compiled `lib/`, so `npm test` builds first. Add regression coverage for changed lifecycle behavior and always clean up owned processes, servers, and temporary directories.

There is no numeric coverage requirement. CI runs fixture tests on Linux and macOS and compilation on Windows. Report packaged application, platform, and real-model checks separately; record checks that were not run. Never use a successful HTTP check as evidence of model success.

## Pull requests

Use English for issue text, PR descriptions, and commit messages. Use a short imperative commit subject, such as `Fix cancellation during backend startup`. Keep each PR focused on one change.

Describe the problem, resulting behavior, linked issues (`Closes #123` where applicable), test commands and results, platform limitations, and screenshots for visible UI changes. Update English documentation and its `.zh-CN.md` counterpart together. Use the PR template and ensure CI passes before merging.

Treat contributors respectfully, keep feedback specific to the work, and remove credentials, session content, and personal paths from shared diagnostics. The project uses the [MIT license](LICENSE); submit only material you have the right to contribute under that license.
