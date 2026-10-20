# agent-workflow

本地桌面应用：选项目、选流程、写一句需求，AI（托管的 opencode 1.19.0）在独立 Git worktree 中完成开发，你查看结果并决定是否合并。默认简单，专业能力可选开启。

设计与规范见 [docs/](docs/README.md)。

## 安装

需要 macOS（Apple 芯片）、Git，以及 [opencode](https://opencode.ai) **1.19.0**（版本必须一致），并已在终端运行 `opencode auth login` 登录至少一个模型提供方。

1. 下载 `Agent Workflow-<版本>-arm64.dmg`，打开后把 Agent Workflow 拖进「应用程序」。
2. 安装包**没有签名与公证**。从网络下载的副本第一次打开时，macOS 会提示「无法验证开发者」或「已损坏」：
   - 在「应用程序」中右键（或按住 Control 点按）Agent Workflow →「打开」→ 在弹窗中再点「打开」；或
   - 先尝试打开一次，然后到「系统设置 → 隐私与安全性」，在「安全性」一栏找到「已阻止使用 Agent Workflow」，点「仍要打开」，输入密码确认。
   - 只需放行一次。若提示「已损坏，无法打开」，在终端执行 `xattr -dr com.apple.quarantine "/Applications/Agent Workflow.app"` 去掉下载隔离标记后再打开。
3. 首次启动是引导页：检测 Git、opencode 1.19.0 与可用模型，未通过的项给出修复命令；全部通过后添加第一个 Git 仓库即可开始。

应用数据（数据库、会话记录、日志、独立工作区）在 `~/Library/Application Support/Agent Workflow/`；版本号见「设置 → 关于」。

## 开发环境

- macOS（arm64）、Node.js 24.19+、pnpm 10.28（`corepack enable`）、Git
- opencode 1.19.0（已登录至少一个模型提供方；开发与测试用免费模型 `opencode-go/beam-free`）

```bash
pnpm install
```

如需经代理下载 Electron：`NODE_USE_ENV_PROXY=1 pnpm install`（Node 24 才会读取 `HTTPS_PROXY`）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动桌面应用（开发模式，后端固定端口 47821，前端 47822） |
| `pnpm dev:server` / `pnpm dev:web` | 单独启动后端（Node 直接运行 TS）/ 浏览器前端 |
| `pnpm verify` | 提交前全量检查：类型、Biome、依赖边界、CSS 令牌、单元与集成测试、构建 |
| `pnpm e2e` | 浏览器模式 E2E |
| `pnpm e2e:electron` | Electron 模式 E2E（需先 `pnpm build`） |
| `pnpm dist` | 打包 macOS arm64 .dmg（未签名） |

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
