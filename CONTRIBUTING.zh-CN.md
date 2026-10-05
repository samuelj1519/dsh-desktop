# 贡献指南

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

## 开始前

先搜索已有 Issue。较大的行为或架构变更应先讨论，再实现。使用 Issue 模板报告可复现的缺陷或提出功能需求。漏洞通过[私密安全报告渠道](SECURITY.zh-CN.md)提交。

阅读 [AGENTS.md](AGENTS.md) 了解模块组织和代码规范。修改连接状态、进程所有权、IPC 或持久化时，先阅读[架构设计](docs/design.zh-CN.md)和[客户端实现](docs/client.zh-CN.md)。

## 本地开发流程

1. 使用 Node.js 22.12.0 或更高版本；使用 `.nvmrc` 中的版本复现 CI 环境（已安装 nvm 时运行 `nvm use`）。
2. 运行 `npm ci` 安装依赖。
3. 创建聚焦单一变更的分支，例如 `fix/startup-cancellation` 或 `docs/connection-guide`。
4. 修改 `src/` 和 `ui/`；生成的 `lib/` 和 `dist/` 不纳入 Git。
5. 运行 `npm test`。界面变更还需运行 `npm start`，使用隔离应用数据检查键盘导航、错误提示、重新连接和退出。

遵循既有 TypeScript 风格：两个空格缩进、单引号、分号，以及 NodeNext 的 `.js` 导入路径。目前未配置格式化器或 linter。避免无关的格式调整。依赖元数据变更时同步更新 `package-lock.json`，依赖升级时保留精确版本。

## 测试与验证

使用 Node 的 `node:test` 和 `node:assert/strict`。行为测试放在 `test/*.test.mjs`，模拟服务放在 `test/fixtures/`。测试导入编译后的 `lib/`，因此 `npm test` 会先构建。生命周期行为变更应补充回归覆盖；测试结束后必须清理自有进程、服务和临时目录。

没有数值化覆盖率要求。CI 在 Linux 和 macOS 上运行 fixture 测试，在 Windows 上执行编译。分别报告打包应用、平台和真实模型检查结果；注明未执行的检查。HTTP 检查成功不能作为模型成功的证据。

## Pull Request

Issue 正文、PR 描述和提交消息使用英文。提交标题使用简短的祈使句，例如 `Fix cancellation during backend startup`。每个 PR 聚焦一项变更。

说明问题、变更后的行为、关联 Issue（适用时使用 `Closes #123`）、测试命令和结果、平台限制，以及可见界面变更的截图。同步更新英文文档及对应的 `.zh-CN.md`。使用 PR 模板，合并前确保 CI 通过。

尊重贡献者，反馈应针对具体工作。共享诊断信息前移除凭据、会话内容和个人路径。项目使用 [MIT 许可证](LICENSE)；仅提交有权按该许可证贡献的内容。
