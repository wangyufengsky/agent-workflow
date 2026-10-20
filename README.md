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
- opencode 1.19.0（已登录至少一个模型提供方；调用模型的测试默认用免费模型 `opencode-go/deepseek-v4.1-flash`，`AW_OC_TEST_MODEL` 可改）
- Docker 与 `mysql:8.4` 镜像（`docker pull mysql:8.4`）：数据库集成测试用；live 测试的 Java 示例仓库需要 JDK 17+ 与 Maven

```bash
pnpm install
pnpm dev
```

如需经代理下载 Electron：`NODE_USE_ENV_PROXY=1 pnpm install`（Node 24 才会读取 `HTTPS_PROXY`）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动桌面应用（开发模式，后端固定端口 47821，前端 47822） |
| `pnpm dev:server` / `pnpm dev:web` | 单独启动后端（Node 直接运行 TS）/ 浏览器前端 |
| `pnpm verify` | 提交前全量检查：类型、Biome、依赖边界、CSS 令牌、状态机文档、单元与集成测试、构建 |
| `pnpm e2e` | 浏览器模式 E2E（FakeOpencode 扮演 AI；含四主题走查，截图写到 `screenshots/walkthrough/`） |
| `pnpm e2e:electron` | Electron 模式 E2E（需先 `pnpm build`；真实 opencode 与免费模型；`AW_E2E_EXECUTABLE` 可指向打包后的应用） |
| `pnpm test:oc` | 真实 opencode 的集成测试（只有 bridge 插件测试调用模型） |
| `pnpm test:live` | 真实模型跑五个内置流程（手动，约一小时；报告写到 `live/reports/`） |
| `pnpm perf` | 性能实测：20 节点画布帧率、5 MB 会话流首屏、10 个并发任务（结果写到 `perf-results/`） |
| `pnpm dist` | 打包 macOS arm64 .dmg（未签名，输出到 `apps/desktop/release/`） |

## 架构入口

一个 Electron 应用，三个进程：

```
Electron main（apps/desktop/src/main）
  ├─ utilityProcess：后端（packages/server，Fastify + SQLite），只监听 127.0.0.1
  │    ├─ 托管一个 opencode serve 1.19.0（所有任务的 AI 会话；注入本应用的 MCP 与 agent）
  │    └─ 同源提供前端页面、REST /api/v1、SSE /api/v1/events、执行 MCP /mcp/exec
  └─ 窗口：前端（apps/web，React 19 + TanStack Query + React Flow），经 preload 拿到令牌
```

读代码从这些地方开始：

| 想了解 | 看这里 |
| --- | --- |
| 共享的枚举、错误码、状态机、契约 | `packages/shared/src/`（`enums/`、`errors/codes.ts`、`fsm/`、`contracts/`、`operations/`） |
| 后端组装与启动 | `packages/server/src/app.ts`、`main.ts`；模块在 `src/modules/<名称>/`，对外只经 `index.ts` |
| 一个任务怎么跑 | `modules/tasks` → `scheduler` → `nodes` → `attempts` → `opencode`；AI 调用的工具在 `modules/mcp` |
| 页面与路由 | `apps/web/src/app/routes.ts`、`router.tsx`；页面在 `src/features/`；文案只在 `src/copy/` |
| 测试辅助 | `packages/server/test/`（`createTestApp`、`FakeOpencode`、`FakeHosting`、`startMysql`） |

完整设计见 [docs/](docs/README.md)：产品与验收 [01](docs/01-product.md)、决策 [02](docs/02-decisions.md)、架构 [03](docs/03-architecture.md)、规范 [06](docs/06-coding-standards.md) / [07](docs/07-testing-standards.md)，v1.0 验收报告 [16](docs/16-acceptance-v1.0.md)。

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
