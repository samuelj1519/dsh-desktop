# dsh-desktop

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI](https://github.com/samuelj1519/dsh-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelj1519/dsh-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个承载本机 dsh Web UI 的 Electron 薄桌面客户端。所连接的 dsh 服务负责工作区、会话、模型、流式回复、工具和权限询问。客户端负责连接设置、窗口和自己启动的后端生命周期。

## 环境要求

- 开发需要 Node.js 22.12.0 或更高版本及 npm；`.nvmrc` 固定 CI 使用的 Node.js 版本。
- 需要单独安装 dsh runtime 并配置模型。应用不包含 runtime 或模型配置。
- 初始打包目标为 macOS arm64。提供 Windows 和 Linux 打包命令；原生应用行为需要分别验证。

## 快速开始

```bash
git clone https://github.com/samuelj1519/dsh-desktop.git
cd dsh-desktop
npm ci
npm start
```

连接窗口目前使用中文标签。选择连接方式：

- **现有服务**：连接明确指定的 `localhost`、`127.0.0.1` 或 `[::1]` HTTP 服务根地址。默认地址为 `http://127.0.0.1:3080`。断开或退出客户端不会停止这个服务。
- **客户端启动**：选择可执行的 Node 程序、可读的已安装 dsh JavaScript CLI 文件（通常为 `lib/bin.js`）、dsh Home 和工作目录。路径必须为绝对路径。客户端使用本机回环地址和自动分配的端口启动 dsh，不打开外部浏览器。

在 dsh 页面中管理会话、发送请求、处理工具权限和取消当前请求。「停止后端」停止整个客户端自有服务。「连接设置…」用于重新连接或修改设置。

## 开发与打包

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 安装锁定的依赖。 |
| `npm run build` | 执行严格 TypeScript 检查并生成 `lib/`。 |
| `npm test` | 构建并运行 Node 行为测试。 |
| `npm start` | 构建并启动 Electron。 |
| `npm run package:mac` | 生成 `dist/DSH-darwin-arm64/DSH.app`。 |
| `npm run package:windows` | 打包 Windows x64 应用。 |
| `npm run package:linux` | 打包 Linux x64 应用。 |

从打包输出目录打开 macOS 应用。打包会覆盖对应平台的输出目录。构建产物未签名；尚未配置签名、公证、自动更新或全局安装。Fixture 测试和 HTTP 就绪不能证明模型请求成功。CI 在 Linux 和 macOS 上运行行为测试，在 Windows 上执行编译；不用于认证原生界面或模型行为。

## 设置与持久数据

客户端在 Electron 应用数据目录保存 `connection.json`、浏览器数据，以及默认自有 `dsh-home/` 和 `workspace/`。macOS 默认位置为 `~/Library/Application Support/dsh-desktop/`。如需使用已有模型和会话，明确选择已有 dsh Home；客户端不会复制模型凭据。

只有连接成功后才保存设置。下次启动会用最后一次成功的设置尝试恢复一次；失败时保留设置窗口。退出时保留 Home、工作目录和会话。

进行隔离检查时，指定绝对应用数据路径：

```bash
DSH_DESKTOP_USER_DATA=/absolute/path/dsh-client-data npm start
# 或启动已打包的 macOS 应用：
DSH_DESKTOP_USER_DATA=/absolute/path/dsh-client-data /path/to/DSH.app/Contents/MacOS/DSH
```

相对路径会报错退出。覆盖仅影响客户端设置、浏览器数据和默认自有目录，不修改全局 dsh 或 agent 配置。

## 故障排查

- **无法连接**：检查本机服务地址和端口，再重试。HTTP 就绪只证明传输可用，不证明模型请求成功。
- **启动失败**：检查 Node、CLI 文件、Home 和工作目录。展开后端诊断查看有限长度的输出。如果 dsh 配置将监听地址改为非回环地址，客户端会停止自有后端并报错，不改写全局配置。
- **设置损坏**：修改参数后选择「修复设置并连接」。成功后先为原 `connection.json` 创建带时间戳的备份，再替换设置。
- **页面失败**：重新打开连接设置并重新连接。页面错误与连接状态分别显示。
- **退出失败**：应用保留窗口、错误和后端所有权。选择「重试退出」。关闭最后一个可见窗口或使用退出菜单时，会等待自有后端清理；不会按端口或 URL 匹配停止外部服务。

## 文档与贡献

- [Architecture](docs/design.md) · [架构设计](docs/design.zh-CN.md)
- [Client implementation](docs/client.md) · [客户端实现](docs/client.zh-CN.md)
- [Contributing](CONTRIBUTING.md) · [贡献指南](CONTRIBUTING.zh-CN.md)
- [Security policy](SECURITY.md) · [安全政策](SECURITY.zh-CN.md)
- [Contributor guide for agents](AGENTS.md) · [代理贡献指南](AGENTS.zh-CN.md)

仓库文档、Issue、Pull Request 和提交消息默认使用英文。修改文档所述行为时，同步更新中文版本。

## 许可证

[MIT](LICENSE)。dsh 及其他第三方依赖保留各自的许可证。本项目为独立桌面客户端。
