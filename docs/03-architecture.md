# 03 · 架构与技术选型

## 1. 进程拓扑

```
┌──────────────────────────── Electron 应用 ────────────────────────────┐
│ main（薄）：窗口、菜单、文件夹选择、safeStorage 加解密、子进程生命周期   │
│   │ preload：暴露 window.aw = { apiToken, appVersion, selectDirectory,│
│   │          openExternal, revealInFinder }（不含加解密）             │
│   ▼                                                                   │
│ renderer（React，由后端同源托管）── 相对路径 /api/v1 + SSE ──┐        │
│                                                         ▼              │
│ utilityProcess：后端服务（Node 24 + Fastify，127.0.0.1:随机端口）       │
│   ├─ /api/v1/*      REST（renderer 令牌）                               │
│   ├─ /api/v1/events SSE                                                │
│   ├─ /              构建后的前端静态文件（同源，D31）                   │
│   ├─ /mcp/exec      执行 MCP，Streamable HTTP（执行 MCP 令牌）          │
│   ├─ /mcp/assistant 助手 MCP（v1.1，独立令牌，server agent-workflow-app） │
│   ├─ SQLite（app.db）+ JSONL 日志                                       │
│   ├─ git CLI / GitHub / GitLab / mysql2                                │
│   └─ 子进程：opencode serve 1.19.0（127.0.0.1:随机端口）                 │
│         └─ 配置注入：mcp.agent-workflow → .../mcp/exec                 │
│                     mcp.agent-workflow-app → .../mcp/assistant（v1.1） │
│                     agent: aw-planner / aw-executor / aw-reviewer      │
│                            aw-assistant（v1.1）                         │
│                     plugin: agent-workflow-bridge（注入 sessionID）     │
└───────────────────────────────────────────────────────────────────────┘
```

- **main 不含业务逻辑**。凡需要系统能力（选目录、加解密）的，renderer 通过 preload 调 main；后端需要加解密时经 utilityProcess 的 `MessagePort` 请求 main。
- **后端是唯一的状态权威**。renderer 不直接碰 Git、SQLite、opencode、MySQL。
- **凭据加解密**：后端经 utilityProcess 的 `process.parentPort` 发 `credential.request`（`encrypt` / `decrypt`，协议 schema 在 `shared/contracts/credential-port.ts`），main 用 safeStorage 处理后回 `credential.response`；safeStorage 不可用时后端抛 `CREDENTIAL_UNAVAILABLE`。
- **后端可独立运行**：`pnpm --filter server dev` 用系统 Node 24 启动，renderer 用浏览器打开即可开发与跑 E2E（此时 safeStorage 由开发用的明文适配器替代，仅限 `NODE_ENV=development`；该分支在生产构建中被常量折叠删除，`pnpm build` 末尾的 `scripts/check-prod-bundle.mjs` 校验产物中不存在它）。
- 令牌：每次启动随机生成 renderer 令牌与各 MCP 令牌，只存在内存；端口均为随机端口，仅绑定 127.0.0.1。开发时后端固定 `DEV_API_PORT`，Vite 把 `/api/v1` 代理过去（D31）。
- **两套 MCP 权限隔离**：执行 MCP 只给执行任务的 AI 会话用，工具绑定到所属尝试；助手 MCP（v1.1，见 [15-assistant.md](15-assistant.md)）给应用助手用，能力来自操作清单，写操作需用户确认。

## 2. 关键运行流程

### 2.1 启动

1. main 启动 utilityProcess（后端），传入数据目录、令牌。
2. 后端：打开 SQLite → 执行迁移 → 启动 HTTP → 环境检测（git 版本、opencode 路径与版本）。
3. 版本精确等于 `OPENCODE_VERSION`（1.19.0）时启动 `opencode serve --hostname 127.0.0.1 --port 0`，环境变量 `OPENCODE_CONFIG_CONTENT` 注入配置；从 stdout 解析监听地址；订阅其事件流。
4. 恢复：把上次退出时仍为 `running/starting` 的尝试标为 `interrupted`（等待阻塞问题答案的除外，D46），对应节点回到 `ready`（不消耗预算）；仍在 `running`/`verifying` 而没有工作中尝试的节点回到 `ready`；仍在 `preparing` 的任务重新准备工作区。
4a. API 开始监听后（`app.start(port)`）调度器开始工作：重新派发 `ready` 节点、为规划中的任务启动规划会话。
5. 后端经 `process.parentPort` 通知 main 监听端口；main 创建窗口加载 `http://127.0.0.1:<port>/`，令牌经 `additionalArguments` 传给 preload。

### 2.2 一个任务的生命周期（简单模式）

```
创建任务 → preparing：git worktree add -b aw/T-12-xxx <worktreesDir>/<project>/T-12 <base>
        → planning：新建 opencode 会话(directory=worktree, agent=aw-planner)，
                    提示词要求调用 MCP get_task_context → submit_plan
        → （无 confirm_plan 检查点）自动确认计划，生成节点
        → running：调度器派发 ready 节点 → 每个节点一次会话(agent=aw-executor)
                    → 模型改代码（原生 edit/bash）→ 调用 MCP submit_result
                    → 验收（测试命令 / AI 评审会话 submit_review）→ done
        → review：全部节点完成，生成结果卡（diff 统计、测试结果、各节点摘要）
        → 用户点「合并」→ merging → completed；清理 worktree 与分支
```

### 2.3 AI 提问

`ask_user` 工具：若任务未开启 `ask_on_uncertainty` 且模型给出了 `default_assumption`，立即返回「按假设继续」并把假设记入节点产出；否则创建「需要你处理」条目，工具返回「结束本轮，答案会作为下一条消息发给你」。会话空闲后节点进入 `waiting_input`；用户回答后后端向**同一会话**发送答案消息，节点回到 `running`。不依赖长时间阻塞的工具调用。

### 2.4 会话空闲但未提交结果

收到 `session.idle` 且尝试未提交结果、也无待回答的阻塞问题时：发送一次提醒消息（「你必须调用 submit_result」）；再次空闲仍未提交 → 尝试 `failed`（`ATTEMPT_NO_RESULT`），按重试预算重试。

### 2.5 权限请求

opencode 全局事件 `permission.asked`（含 `id`、`sessionID`、`permission`、`patterns`、`directory`）→ 创建「需要你处理」条目（类型 permission）→ 用户选择「允许一次 / 总是允许 / 拒绝」→ `permission.reply({ requestID, directory, reply: 'once' | 'always' | 'reject' })`（D34）。

## 3. 技术选型与依赖清单

版本为 2026-10-19 npm 最新稳定版，精确锁定（`.npmrc` 中 `save-exact=true`）。标「引入时锁定」的在首次使用的里程碑选定具体版本。

| 用途 | 依赖 | 版本 |
| --- | --- | --- |
| 桌面 | electron | 44.9.0 |
| 构建 | electron-vite / vite / @vitejs/plugin-react | 6.0.0 / 8.3.4 / 6.1.2 |
| 打包 | electron-builder | 26.15.3 |
| UI | react / react-dom | 19.3.1 |
| 路由 | @tanstack/react-router | 1.170.45 |
| 服务端状态 | @tanstack/react-query | 5.104.4 |
| 界面状态 | zustand | 5.0.15 |
| 画布 | @xyflow/react + elkjs | 12.12.0 / 0.12.0 |
| 无样式组件 | @radix-ui/react-dialog、@radix-ui/react-tabs（Dialog、Drawer、命令面板、Tabs）；Popover、Tooltip、DropdownMenu、Select 引入时锁定 | 1.3.1 / 1.2.1 |
| Markdown 渲染 | react-markdown + remark-gfm（不渲染原始 HTML，模型产出的摘要与报告） | 10.1.0 / 4.0.1 |
| 表单 | react-hook-form + @hookform/resolvers | 引入时锁定（M1 表单字段少，用受控组件） |
| diff / 代码高亮 | shiki（JavaScript 正则引擎、CSS 变量主题，按扩展名懒加载语法）；unified / split 视图与文件树为自写组件 `components/diff/`（D54） | 4.5.0 |
| 契约 | zod | 4.6.7 |
| HTTP | fastify（请求校验由操作清单挂载层直接用 zod 解析，见 D39） | 5.12.7 |
| MCP | @modelcontextprotocol/sdk | 1.32.1 |
| opencode 客户端 | @opencode-ai/sdk | **1.19.0（与 CLI 一致）** |
| opencode 插件类型 | @opencode-ai/plugin（仅类型，开发依赖） | 1.19.0 |
| SQLite | `node:sqlite`（内置，D30） | — |
| ORM / 迁移 | drizzle-orm（经 `core/db/node-sqlite-client.ts` 适配器复用 better-sqlite3 同步会话）+ drizzle-kit | 0.45.4 / 0.31.11 |
| MySQL | mysql2 | 3.24.6 |
| 子进程 | execa | 10.2.0 |
| GitHub / GitLab | @octokit/rest / @gitbeaker/rest | 22.0.1 / 43.8.0 |
| 日志 | pino | 10.4.0 |
| 测试 | vitest / @playwright/test | 5.0.5 / 1.64.1 |
| 界面走查的对比度检查 | @axe-core/playwright（E2E 中只跑 `color-contrast` 规则，M6-01） | 4.13.0 |
| 类型 | @types/node / @types/react / @types/react-dom | 24.19.2 / 19.3.0 / 19.3.0 |
| 代码质量 | @biomejs/biome / dependency-cruiser / typescript | 2.5.15 / 18.6.0 / **6.0.3**（D29） |
| 静态文件 | @fastify/static | 10.1.6 |

**明确不引入**：Temporal / BullMQ（单机够用）、XState（见 D21）、tRPC（要可文档化 REST）、Tailwind（已有令牌与样式体系）、Monaco（v1 不在应用内编辑代码）、任何 ORM 之外的数据访问层封装。

新增依赖须在本表登记并说明用途。

## 4. 仓库结构

```
agent-workflow/
├─ apps/
│  ├─ desktop/                 Electron main + preload
│  │  └─ src/{main,preload}/
│  └─ web/                     React renderer
│     └─ src/
│        ├─ app/               路由表、Provider、布局、导航配置
│        ├─ api/               HTTP 客户端、query keys、SSE 订阅
│        ├─ theme/             themes/*.ts、applyTheme、token 类型
│        ├─ styles/            base.css（由设计稿 ds.css 迁移）
│        ├─ components/        通用组件（Button、StatusBadge、Panel…）
│        ├─ canvas/            React Flow 节点类型、ELK 布局、画布工具栏
│        ├─ features/          按功能：home / tasks / task-detail / node-detail / inbox /
│        │                     projects / git / workflows / roles / databases / tools /
│        │                     runtime / settings / onboarding
│        └─ copy/              用户可见文案常量（状态名、按钮、提示）
├─ packages/
│  ├─ shared/                  纯 TS，无运行时依赖（除 zod）
│  │  └─ src/
│  │     ├─ enums/             所有枚举（as const）
│  │     ├─ constants/         默认值、限制值、命名规则
│  │     ├─ errors/            错误码表
│  │     ├─ fsm/               通用转换器 + 各实体转换表
│  │     ├─ contracts/api/     REST 请求/响应 zod schema
│  │     ├─ contracts/mcp/     MCP 工具输入/输出 zod schema
│  │     ├─ contracts/events/  SSE 事件 schema
│  │     ├─ operations/        操作清单契约（defineOperationContract）
│  │     ├─ workflow/          流程定义 schema、计划图 schema 与校验
│  │     └─ naming.ts          slug 转写（分支名、项目目录名）
│  ├─ server/                  后端
│  │  └─ src/
│  │     ├─ core/              config、db（含 unit-of-work 环境事务）、logger、event-bus、errors、http、operations、sse
│  │     └─ modules/
│  │        ├─ system/  settings/  credentials/
│  │        ├─ projects/  git/  hosting/  worktrees/
│  │        ├─ workflows/  roles/
│  │        ├─ tasks/  plans/  nodes/  attempts/  scheduler/  acceptance/  timeline/（task_events）
│  │        ├─ opencode/           runtime（进程托管）、client、event-bridge、prompts
│  │        ├─ mcp/                server + tools/*
│  │        ├─ inbox/  delivery/
│  │        └─ databases/          drivers/mysql
│  ├─ builtin/                 内置流程与角色（数据 + prompts/*.md）
│  └─ opencode-plugin/         agent-workflow-bridge（注入 sessionID 到本项目 MCP 工具参数）；`pnpm build:plugin` 去掉类型生成 dist/agent-workflow-bridge.js
├─ e2e/                        Playwright：浏览器旅程、四主题走查（walkthrough）、Electron 旅程 J10、性能实测（*.perf.spec.ts）
├─ live/                       真实模型的 live 测试与示例仓库（fixtures/）
├─ scripts/                    构建插件、生产包检查、CSS 令牌检查、状态机文档生成
├─ docs/
└─ opencode-workflow-design-showcase/  设计参考（只读）
```

### 4.1 后端模块约定

每个模块目录：

```
modules/tasks/
├─ index.ts            对外唯一出口（导出 service 实例工厂与类型）
├─ tasks.operations.ts 操作实现：把清单中的操作契约绑定到 service（REST 由此自动挂载）
├─ tasks.routes.ts     仅非清单路由（流式、文件内容等），多数模块没有此文件
├─ tasks.service.ts    业务逻辑、状态转换、事务
├─ tasks.repo.ts       Drizzle 读写
├─ tasks.table.ts      Drizzle 表定义
├─ tasks.mapper.ts     行 ↔ 领域对象 ↔ DTO（需要时）
└─ tasks.service.test.ts
```

依赖方向（dependency-cruiser 强制）：

- `operations / routes → service → repo`；跨模块只能 import 对方的 `index.ts`。例外：表定义文件可以直接引用其他模块的表定义文件以声明外键（D43）。
- 任务域的服务分层（D45）：`inbox`、`plans`、`timeline`、`worktrees` → `attempts` → `acceptance` → `nodes` → `tasks` → `scheduler`；`mcp` 在最上层。`assistant`（v1.1）与 `mcp` 同在最上层：它从 `app.ts` 拿到其余所有模块的操作实现来生成工具，并用 `attempts` 的会话流存储与会话视图、`tasks` / `projects` / `workflows` 查页面上的名称。尝试经 `attempts.onSignal` 通知其所有者（节点、规划、评审），不反向依赖；需要完整任务上下文的入口（`inbox.resolve`、`projects.delete`、节点通过/驳回/重试、删除流程与角色）由 `tasks` 实现。`databases` 在 `projects` 之下（项目详情列出关联的连接），任务上下文与数据库 MCP 工具经 `tasks` 使用它；`workflows` 依赖 `roles`（校验流程定义）。
- 跨服务的写入用 `core/db/unit-of-work` 的 `transact`（嵌套加入外层事务，事件在提交后发出，D44）。
- `core` 不依赖 `modules`；`shared` 不依赖任何 app/package；`web` 只依赖 `shared`。
- 模块间不循环。需要反向通知时用 `core/event-bus` 发领域事件。

### 4.2 扩展点（只在这些地方定义接口）

| 扩展点 | 接口 | v1 实现 |
| --- | --- | --- |
| 托管平台 | `GitHostingProvider` | github、gitlab |
| 数据库 | `DbDriver` | mysql |
| 验收方式 | `acceptance` 模块的检查函数（`runCommand` / `review`，结果为 `CheckResult`） | command、ai_review |
| 主题 | `ThemeDefinition`（数据） | 4 套 |
| 流程与角色 | `WorkflowDefinition` / `RoleDefinition`（数据） | 5 个流程、4 个角色 |
| 执行 MCP 工具 | `McpToolDefinition`（schema + handler + 允许的尝试类型） | 见 12-mcp-tools |
| 功能操作 | `OperationContract` + `implement()`（见 §5） | 各模块 |

其他地方不为「将来可能」预留抽象。

## 5. 操作清单（Operation Registry）

应用的每个对外功能操作在 `shared/operations/`（输入输出 schema、元数据）与 `server/modules/<m>/<m>.operations.ts`（handler）中**只定义一次**，以下入口全部从清单派生：

| 入口 | v1.0 | v1.1 |
| --- | --- | --- |
| REST API | ✅ 路由由清单挂载 | |
| ⌘K 命令面板 | ✅ `expose.palette` 的操作 | |
| 助手 MCP | 预留字段 | ✅ `expose.assistant` 的操作（剔除凭据与 `assistantOmit` 字段，按界面模式过滤，D65） |
| 对外 MCP（供 Claude Desktop 等外部客户端） | — | 候选 |

```ts
// shared/operations/tasks.ts
export const startTaskOp = defineOperationContract({
  id: 'tasks.start',                     // 领域.动作；助手工具名 tasks_start
  title: 'op.tasks.start',               // 文案 key
  description: 'Create a development task and start it',   // 给模型看的英文说明
  input: createTaskRequestSchema,
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks' },
  expose: { palette: false, assistant: true },
  credentialFields: [],                  // 此类字段不会出现在助手工具 schema 中
  // assistantOmit: [...],               // 可选：其他助手不能设置的字段（D65，如 settings.update 的 assistant.alwaysAllow）
  // produces: { kind: EntityKind.Task, ref: (t) => ({ id: t.id, title: t.title }) },  // 可选：产出的对象（D66，助手的导航卡片）
  mode: UiMode.Simple,                   // 最低可见界面模式
});

// server/modules/tasks/tasks.operations.ts —— 闭包持有本模块 service，由模块 index.ts 的工厂组装
export function taskOperations(tasks: TasksService) {
  return [
    implement(startTaskOp, (input) => tasks.create(input)),
    // ...
  ];
}
```

- `core/operations` 负责：把清单挂载为 Fastify 路由（统一校验、错误映射）、提供 `GET /operations` 给命令面板、v1.1 生成助手 MCP 工具。
  - 输入：路径参数、query、body 合并为一个对象后用 `input` 解析（路径参数优先，body 必须是 JSON 对象），失败 400 `VALIDATION_FAILED`。
  - 输出：handler 返回值用 `output` 解析后返回，DTO 之外的字段被剥离；不匹配视为缺陷（500）。`http.status` 缺省 200，`output` 为 `z.void()` 时 204。
  - `GET /operations?expose=palette|assistant`：`palette` 只含 `expose.palette` 且非 `critical` 的操作；每项含 `id`、`title`、`description`、`risk`、`mode`、`method`、`path`、`inputSchema`（JSON Schema）。
- SSE、会话流 transcript、diff 文件内容等流式或二进制接口不走清单，单独定义路由（清单只管「一次调用、一个结果」的操作）。
- 执行 MCP 工具（12）**不**来自清单：它们绑定在尝试上，语义不同，单独用 `defineMcpTool` 定义；两者共享 service。
- 新增功能 = 写 service + 注册操作；不手写 route。

## 6. 配置化

- **常量与枚举**：全部在 `packages/shared/src/{enums,constants}`，见 [08-enums-and-errors.md](08-enums-and-errors.md)。
- **用户设置**：存 SQLite `settings` 表，键名与默认值在 `shared/constants/settings.ts` 一处定义，带 zod schema。
- **应用配置**（数据目录、opencode 路径覆盖、日志级别）：`core/config.ts` 从环境变量读取一次并校验，其他代码只读 `config` 对象。
- **导航菜单**：`web/src/app/navigation.ts` 配置项含 `visibleIn: 'simple' | 'pro'`。
- **文案**：`web/src/copy/*`，组件中不写裸中文字符串（除临时调试）。
- **主题**：`web/src/theme/themes/*.ts`，见 [14-ui-spec.md](14-ui-spec.md#4-主题配置)。
- **流程与角色**：`packages/builtin` 下的数据文件 + Markdown 提示词，首启时写入数据库（`kind=builtin`，只读；用户可复制后修改）。

## 7. 数据目录

位置为 Electron 的 `userData`：macOS `~/Library/Application Support/Agent Workflow/`，Windows `%APPDATA%\Agent Workflow\`，Linux `~/.config/Agent Workflow/`（17 §3.1）。

```
<userData>/
├─ app.db                      SQLite（WAL）
├─ logs/
│  ├─ app-YYYYMMDD.log         pino
│  └─ opencode-YYYYMMDD.log    opencode stdout/stderr
├─ runs/
│  └─ <taskId>/
│     └─ <attemptId>.jsonl     会话流（消息/片段/工具调用镜像）；任务时间线在 SQLite task_events
├─ worktrees/
│  └─ <projectSlug>/<taskKey>/ 任务 worktree（默认位置，可在设置中改）
└─ assistant/                  助手工作目录（v1.1）：会话 directory；files/<对话 id>/ 生成的文件，conversations/<对话 id>.jsonl 消息流
```

## 8. 并发与一致性

- SQLite 单连接、单写者；多行状态变更放进同一事务。
- 状态变更只通过 `fsm.transition()`，转换表在 `shared/fsm`；非法转换抛 `STATE_TRANSITION_INVALID`。
- Git：同一仓库会改动 refs 或 worktree 列表的操作（worktree add/remove、branch 删除、merge、push）经**每仓库互斥锁**串行；worktree 内部的读写彼此独立。
- 调度器：全局并发上限 `maxConcurrentAttempts`（计入 `running`/`verifying` 的节点与规划中的任务）、每任务上限 `maxConcurrentNodesPerTask`（另计入等待输入的节点）；事件驱动（任务、节点、尝试、设置、运行时变化）触发一次调度，同一时刻只有一次调度在运行，不轮询（D47）。纯决策函数为 `scheduler.decide.ts`。

## 9. 安全边界

- renderer：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、CSP `default-src 'self'`；主窗口禁止导航到应用以外的地址、禁止 `window.open`。
- 凭据（Git 令牌、数据库密码）：经 main 的 safeStorage 加密后存 SQLite，只在使用时解密；不写日志、不进 DTO、不进 MCP 返回值。
- opencode 会话：`directory` 为任务 worktree；`external_directory: deny`；edit 允许；bash 按角色基线（见 13-builtin-workflows）。
- 执行 MCP：独立令牌；每次调用根据 sessionID 解析到唯一的活动尝试，工具按尝试类型授权。
- Git：所有调用设置 `LC_ALL=C`（D37），参数数组传参。
- 助手 MCP（v1.1）：独立令牌；调用按会话归属到助手对话（执行任务的会话调用不了）；写操作经用户确认；凭据字段不进入工具 schema，凭据只能在表单中由用户输入；助手不能修改「总是允许」、opencode 路径、bash 策略与 worktree 目录（D65）。
- 助手会话：`directory` 为 `<数据目录>/assistant/`，`external_directory: deny`，bash 为只读规则、其余询问。
- 数据库工具：只读事务 + 语句类型白名单 + 行数与超时限制。
