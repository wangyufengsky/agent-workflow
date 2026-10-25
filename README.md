# agent-workflow

本地桌面应用：选项目、选流程、写一句需求，AI（托管的 opencode 1.19.0）在独立 Git worktree 中完成开发，你查看结果并决定是否合并。默认简单，专业能力可选开启。

设计与规范见 [docs/](docs/README.md)。

## 安装

需要 Git，以及 [opencode](https://opencode.ai) **1.19.0**（版本必须一致，三个平台都可用 `npm install -g opencode-ai@1.19.0` 安装），并已在终端运行 `opencode auth login` 登录至少一个模型提供方。安装包都**没有签名**。平台差异的完整说明见 [docs/17](docs/17-cross-platform.md)。

### macOS（Apple 芯片）

1. 下载 `Agent Workflow-<版本>-arm64.dmg`，打开后把 Agent Workflow 拖进「应用程序」。
2. 安装包**没有签名与公证**。从网络下载的副本第一次打开时，macOS 会提示「无法验证开发者」或「已损坏」：
   - 在「应用程序」中右键（或按住 Control 点按）Agent Workflow →「打开」→ 在弹窗中再点「打开」；或
   - 先尝试打开一次，然后到「系统设置 → 隐私与安全性」，在「安全性」一栏找到「已阻止使用 Agent Workflow」，点「仍要打开」，输入密码确认。
   - 只需放行一次。若提示「已损坏，无法打开」，在终端执行 `xattr -dr com.apple.quarantine "/Applications/Agent Workflow.app"` 去掉下载隔离标记后再打开。

应用数据在 `~/Library/Application Support/Agent Workflow/`。

### Windows 10 / 11（x64，暂缓：没有在 CI 和真机上验证，D160）

1. 需要 **Git for Windows**（`winget install --id Git.Git -e`）：AI 执行的命令与检查命令都在它自带的 Git Bash 中运行，只装 MinGit 不够。
2. 运行 `agent-workflow-<版本>-setup-x64.exe`。SmartScreen 提示「Windows 已保护你的电脑」时点「更多信息 → 仍要运行」；可以选择安装目录，默认只为当前用户安装。
3. 仓库路径很深时（如 `node_modules`），建议在系统中开启长路径支持（组策略「启用 Win32 长路径」或注册表 `LongPathsEnabled`），否则部分构建工具会失败；本应用调用 git 时已自动启用 `core.longpaths`。

应用数据在 `%APPDATA%\Agent Workflow\`。

### Linux（Ubuntu 22.04+，x64 与 arm64，其他发行版尽力支持）

- **deb**（推荐 Ubuntu / Debian）：`sudo apt install ./agent-workflow_<版本>_amd64.deb`（arm64 机器用 `_arm64.deb`），之后在应用菜单中打开，或运行 `agent-workflow`。
- **AppImage**（其他发行版）：`chmod +x agent-workflow-<版本>-<架构>.AppImage` 后运行。需要 FUSE 2（Ubuntu 24.04：`sudo apt install libfuse2t64`）。Ubuntu 24.04 默认限制非特权用户命名空间，AppImage 可能因 Chromium 沙箱无法启动；请改用 deb，或按发行版说明为该 AppImage 配置 AppArmor 规则。
- 保存托管平台令牌与数据库密码需要系统密钥服务（GNOME Keyring 或 KWallet）；没有时引导页「凭据存储」一项会提示（`sudo apt install gnome-keyring` 后重启应用），其他功能不受影响。

应用数据在 `~/.config/Agent Workflow/`。

### 首次启动

首次启动是引导页：检测 Git、opencode 1.19.0、可用模型与凭据存储，未通过的项给出本平台的修复命令；前三项通过后添加第一个 Git 仓库即可开始。版本号见「设置 → 关于」。

## 开发环境

- macOS（arm64）、Node.js 24.19+、pnpm 10.28（`corepack enable`）、Git
- opencode 1.19.0（已登录至少一个模型提供方；调用模型的测试默认用免费模型 `opencode-go/deepseek-v4.1-flash`，`AW_OC_TEST_MODEL` 可改）
- Docker 与 `mysql:8.4` 镜像（`docker pull mysql:8.4`）：数据库集成测试用；`postgres:17.6`、`opengauss/opengauss-server:7.0.0-RC3.B025`、`mcr.microsoft.com/mssql/server:2022-latest` 可选，没有拉取时对应的测试跳过（24 §7）；live 测试的 Java 示例仓库需要 JDK 17+ 与 Maven

```bash
pnpm install
pnpm dev
```

如需经代理下载 Electron：`NODE_USE_ENV_PROXY=1 pnpm install`（Node 24 才会读取 `HTTPS_PROXY`）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动桌面应用（开发模式，后端端口 47821，前端 47822；`AW_DEV_API_PORT` / `AW_DEV_WEB_PORT` 可覆盖，多个 checkout 同时开发时用） |
| `pnpm dev:server` / `pnpm dev:web` | 单独启动后端（Node 直接运行 TS，监听开发端口；需设 `AW_API_TOKEN` 与 `AW_DATA_DIR`）/ 浏览器前端（代理到同一端口；`VITE_AW_API_TOKEN` 设为同一令牌） |
| `pnpm verify` | 提交前全量检查：类型、Biome、依赖边界、CSS 令牌、状态机文档、单元与集成测试、构建 |
| `pnpm e2e` | 浏览器模式 E2E（FakeOpencode 扮演 AI；含四主题走查，截图写到 `screenshots/walkthrough/`）。后端用系统分配的端口，多个 checkout 可同时运行（D78） |
| `pnpm e2e:electron` | Electron 模式 E2E（需先 `pnpm build`；真实 opencode 与免费模型；`AW_E2E_EXECUTABLE` 可指向打包后的应用） |
| `pnpm e2e:smoke` | Electron 启动冒烟（需先 `pnpm build`；不需要 opencode，CI 在三个平台运行） |
| `pnpm test:oc` | 真实 opencode 的集成测试（只有 bridge 插件测试调用模型） |
| `pnpm test:live` | 真实模型跑五个内置流程（手动，约一小时；报告写到 `live/reports/`） |
| `pnpm perf` | 性能实测：20 节点画布帧率、5 MB 会话流首屏、10 个并发任务（结果写到 `perf-results/`） |
| `pnpm dist` | 打包当前平台的安装包（macOS dmg arm64、Windows NSIS x64、Linux AppImage 与 deb，x64 与 arm64，用 `pnpm dist --x64` / `--arm64` 只打其一；未签名，输出到 `apps/desktop/release/`） |

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
| 测试辅助 | `packages/server/test/`（`createTestApp`、`FakeOpencode`、`FakeHosting`、`startMysql` 等数据库容器，`test/helpers/db-containers.ts`） |

完整设计见 [docs/](docs/README.md)：产品与验收 [01](docs/01-product.md)、决策 [02](docs/02-decisions.md)、架构 [03](docs/03-architecture.md)、规范 [06](docs/06-coding-standards.md) / [07](docs/07-testing-standards.md)，v1.0 验收报告 [16](docs/16-acceptance-v1.0.md)。

## 许可

代码以 Apache-2.0 发布，见 [LICENSE](LICENSE)。

例外：桌宠的临时鲸鱼素材（`apps/web/public/companion/whale/`）来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，**不适用 Apache-2.0**：允许开源使用、禁止商用，分发时须注明原作者地址。详见 [NOTICE](NOTICE)。
