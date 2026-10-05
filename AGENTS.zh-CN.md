# 仓库指南

[English](AGENTS.md) | [简体中文](AGENTS.zh-CN.md)

本页提供既有 `AGENTS.md` 的中文说明。原英文文件保留；初始化后的贡献流程以 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) 为准。

## 项目结构与模块组织

本 Electron 应用承载明确选定的本机 dsh 服务的 Web UI。

- `src/main.ts`：窗口、IPC 校验和应用生命周期。
- `src/backend.ts`、`src/contracts.ts`：后端所有权、连接状态和共享接口。
- `src/config.ts`、`src/preload.cts`、`src/renderer.ts`：设置、受信 IPC 桥和连接界面行为。
- `ui/`：HTML 和 CSS；`test/backend.test.mjs`、`test/fixtures/`：行为测试和模拟服务。
- `docs/design.md`、`docs/client.md`：架构与实现边界。修改进程生命周期、IPC 或连接行为前先阅读。

生成的 `lib/` 和打包的 `dist/` 已被忽略；修改源文件。

## 构建、测试与开发命令

- `npm ci`：从锁文件安装依赖。
- `npm run build`：执行严格 TypeScript 检查并生成 `lib/`。
- `npm test`：构建后使用 Node 测试运行器执行 `test/*.test.mjs`。
- `npm start`：构建并在本地启动 Electron。
- `npm run package:mac`：生成 `dist/DSH-darwin-arm64/DSH.app`。
- `npm run package:windows`、`npm run package:linux`：打包对应平台的 x64 应用；原生行为需单独验证。

启动自有后端需要单独安装 Node 程序和 dsh CLI。

## 代码风格与命名

遵循已有 TypeScript 风格：两个空格缩进、单引号和分号。函数和变量使用 camelCase，类和接口使用 PascalCase，模块文件使用描述性小写名称。NodeNext 模式下，相对 TypeScript 导入保留 `.js` 扩展名；`preload.cts` 输出 CommonJS。共享契约应明确，UI 状态投影应不可变。未配置格式化器或 linter；编译检查严格类型和未使用符号。

## 测试指南

使用 `node:test` 和 `node:assert/strict`。文件命名为 `*.test.mjs`，用例名称描述可观察行为。启动、超时、取消和清理场景的 fixture 放入 `test/fixtures/`。登记进程、服务和临时目录的清理操作。没有覆盖率阈值。运行 `npm test`；原生界面和真实模型检查与 fixture 结果分别报告。

## 提交与 Pull Request

原指南编写时尚无 Git 元数据，无法验证历史约定。使用简短的英文祈使句提交标题，例如 `Fix cancellation during backend startup`。PR 说明行为变更、关联 Issue、执行命令、平台限制，并为界面变更提供截图。当前流程见贡献指南。

## 安全与配置

保留回环地址限制、窗口沙箱和 IPC 校验。只停止自有进程，保留外部服务和持久用户数据。日志不得包含凭据。隔离手动检查使用绝对 `DSH_DESKTOP_USER_DATA` 路径。
