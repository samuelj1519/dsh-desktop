# dsh-desktop

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI](https://github.com/samuelj1519/dsh-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelj1519/dsh-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A thin Electron desktop client for a local dsh Web UI. The selected dsh service owns workspaces, sessions, models, streaming responses, tools, and permission prompts. This client manages connection settings, windows, and the lifecycle of backends it launches.

## Requirements

- Node.js 22.12.0 or newer and npm for development; `.nvmrc` pins the Node.js version used by CI.
- A separately installed dsh runtime and its model configuration. Neither is bundled with the application.
- macOS arm64 is the initial packaging target. Windows and Linux packaging commands are available; native application behavior requires separate validation.

## Quick start

```bash
git clone https://github.com/samuelj1519/dsh-desktop.git
cd dsh-desktop
npm ci
npm start
```

The connection window currently uses Chinese labels. Choose a connection mode:

- **Existing service (现有服务):** connect to an explicit HTTP service root on `localhost`, `127.0.0.1`, or `[::1]`. The default is `http://127.0.0.1:3080`. Disconnecting or quitting leaves that service running.
- **Client launch (客户端启动):** select an executable Node binary, a readable installed dsh JavaScript CLI file (typically `lib/bin.js`), a dsh Home, and a working directory. Use absolute paths. The client launches dsh on loopback with an automatically selected port and without an external browser.

Use the dsh page for sessions, requests, tool permissions, and request cancellation. **Stop backend (停止后端)** stops the entire client-owned service. Open **Connection settings (连接设置…)** to reconnect or change settings.

## Development and packaging

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies. |
| `npm run build` | Check strict TypeScript and emit `lib/`. |
| `npm test` | Build and run Node behavior tests. |
| `npm start` | Build and launch Electron. |
| `npm run package:mac` | Produce `dist/DSH-darwin-arm64/DSH.app`. |
| `npm run package:windows` | Package Windows x64. |
| `npm run package:linux` | Package Linux x64. |

Open the macOS application from the packaging output. Packaging overwrites the matching output directory. Builds are unsigned; signing, notarization, automatic updates, and global installation are not configured. Fixture tests and HTTP readiness do not establish that model requests succeed. CI runs behavior tests on Linux and macOS and compilation on Windows; it does not certify native UI or model behavior.

## Settings and persistent data

The client stores `connection.json`, browser data, and default owned `dsh-home/` and `workspace/` directories under Electron's application data directory. The default macOS location is `~/Library/Application Support/dsh-desktop/`. Select an existing dsh Home explicitly to reuse its models and sessions; the client does not copy model credentials.

Settings are saved only after successful connection. On the next launch, the client attempts to restore the last successful connection once. A failed attempt leaves the settings window available. Quitting preserves Home directories, workspaces, and sessions.

For isolated checks, set an absolute application data path:

```bash
DSH_DESKTOP_USER_DATA=/absolute/path/dsh-client-data npm start
# Or launch a packaged macOS application:
DSH_DESKTOP_USER_DATA=/absolute/path/dsh-client-data /path/to/DSH.app/Contents/MacOS/DSH
```

A relative override exits with an error. The override affects client settings, browser data, and default owned directories; it does not change global dsh or agent configuration.

## Troubleshooting

- **Cannot connect:** check the local service address and port, then retry. HTTP readiness proves transport availability, not model success.
- **Launch fails:** check Node, the CLI file, Home, and the working directory. Expand backend diagnostics for bounded output. If dsh configuration overrides the bind address with a non-loopback address, the client stops its backend and reports the error without rewriting global configuration.
- **Damaged settings:** edit the parameters and select **Repair settings and connect (修复设置并连接)**. After success, the original `connection.json` is backed up with a timestamp before replacement.
- **Page fails:** reopen connection settings and reconnect. Page errors are displayed separately from connection status.
- **Quit fails:** the application retains its window, error, and backend ownership. Select **Retry quit (重试退出)**. Closing the last visible window or using the quit menu waits for owned backend cleanup; external services are never stopped by port or URL matching.

## Documentation and contributions

- [Architecture](docs/design.md) · [架构设计](docs/design.zh-CN.md)
- [Client implementation](docs/client.md) · [客户端实现](docs/client.zh-CN.md)
- [Contributing](CONTRIBUTING.md) · [贡献指南](CONTRIBUTING.zh-CN.md)
- [Security policy](SECURITY.md) · [安全政策](SECURITY.zh-CN.md)
- [Contributor guide for agents](AGENTS.md) · [代理贡献指南](AGENTS.zh-CN.md)

English is the default language for repository documentation, issues, pull requests, and commit messages. Update Chinese documentation alongside the English version when changing documented behavior.

## License

[MIT](LICENSE). dsh and other third-party dependencies retain their own licenses. This project is an independent desktop client.
