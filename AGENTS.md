# Repository Guidelines

## Project Structure & Module Organization

This Electron application hosts the Web UI of an explicitly selected local dsh service.

- `src/main.ts`: windows, IPC validation, and application lifecycle.
- `src/backend.ts` and `src/contracts.ts`: backend ownership, connection state, and shared interfaces.
- `src/config.ts`, `src/preload.cts`, and `src/renderer.ts`: settings, the trusted IPC bridge, and connection UI behavior.
- `ui/`: HTML and CSS assets; `test/backend.test.mjs` and `test/fixtures/`: behavior tests and simulated services.
- `docs/design.md` and `docs/client.md`: architecture and implementation boundaries. Read these before changing process lifecycle, IPC, or connection behavior.

Generated `lib/` and packaged `dist/` are ignored; edit source files instead.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from the lockfile.
- `npm run build`: run strict TypeScript checks and emit `lib/`.
- `npm test`: build, then execute `test/*.test.mjs` with Node’s test runner.
- `npm start`: build and launch Electron locally.
- `npm run package:mac`: create `dist/DSH-darwin-arm64/DSH.app`.
- `npm run package:windows` / `npm run package:linux`: package x64 builds for those platforms; validate native behavior separately.

The application requires a separately installed Node executable and dsh CLI for owned backend launches.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single-quoted strings, and semicolons. Use camelCase for functions and variables, PascalCase for classes and interfaces, and descriptive lowercase module filenames. Preserve `.js` extensions in relative TypeScript imports under NodeNext; `preload.cts` emits CommonJS. Keep shared contracts explicit and UI state projections immutable. No formatter or linter is configured; compilation enforces strict typing and unused-symbol checks.

## Testing Guidelines

Use `node:test` and `node:assert/strict`; name files `*.test.mjs` and cases by observable behavior. Add fixtures under `test/fixtures/` for startup, timeout, cancellation, and cleanup scenarios. Register teardown for processes, servers, and temporary directories. No coverage threshold is configured. Run `npm test`; report native UI and real-model checks separately from fixture results.

## Commit & Pull Request Guidelines

This checkout contains no Git metadata, so historical commit conventions cannot be verified. Use concise imperative subjects, such as `Fix cancellation during backend startup`. PRs should describe behavior changes, relevant issues, commands run, platform limitations, and screenshots for UI changes.

## Security & Configuration

Preserve loopback-only connections, sandboxed windows, and validated IPC. Stop only owned processes; preserve external services and persistent user data. Keep credentials out of logs. Use an absolute `DSH_DESKTOP_USER_DATA` path for isolated manual checks.
