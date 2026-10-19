# 05 · 开发计划

任务编号 `M<里程碑>-<序号>`。每个任务一个分支 + 一个 PR（可合并相邻小任务）。「完成标准」必须可验证。

## M0 · 工程骨架与技术验证（1 周）

> 状态：**已完成**（2026-10-19）。S1–S7 全部通过，结论见 [02-decisions.md](02-decisions.md) D29–D38 与 [12 §8](12-mcp-tools.md#8-opencode-1190-实测记录m0)。命令 `pnpm ci` 与 pnpm 内置命令重名，改为 `pnpm verify`。S7 未能在另一台 Mac 上验证，改为从 dmg 挂载的副本启动验证；未签名应用从网络下载后需在「系统设置 → 隐私与安全性」中放行。

### 工程骨架

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M0-01 | `git init`；pnpm workspace；目录结构按 03 §4；根 `tsconfig.base.json`（strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）；Node 24 `engines` | `pnpm i` 成功；各包空 `index.ts` 可编译 |
| M0-02 | Biome 配置；dependency-cruiser 规则（03 §4.1）；`pnpm check` = tsc + biome + depcruise + `lint:css` | 故意违反一条依赖规则时 `pnpm check` 失败 |
| M0-03 | Vitest（单元 + 集成两套配置）；Playwright（浏览器模式 + Electron 模式）；`pnpm test` / `test:int` / `test:oc` / `e2e` / `test:live` | 各有一个示例测试通过 |
| M0-04 | electron-vite：main / preload / renderer；后端以 utilityProcess 启动并通过 MessagePort 握手；`pnpm dev` 一条命令启动 | 窗口显示后端返回的 `/system/health` |
| M0-05 | 本地 CI 脚本 `pnpm verify`（check + test + test:int + build）；git hooks（pre-commit：biome 格式化暂存文件） | 一条命令跑完 |

### 技术验证（结论写入 02-decisions，验证代码放 `spikes/`，结束后删除）

| # | 验证项 | 通过标准 | 不通过时 |
| --- | --- | --- | --- |
| S1 | opencode 插件 `tool.execute.before` 能为 MCP 工具注入 `sessionID` 到参数，MCP 服务端能收到 | 两个并发会话调用同一工具，服务端分别收到正确 sessionID | 采用 `attempt_token` 参数方案 |
| S2 | Electron 44 utilityProcess 内 `node:sqlite` 可用；Drizzle sqlite-proxy + drizzle-kit 迁移可用；WAL 并发读写 | 迁移执行、1 万行写入、读写并发无错 | better-sqlite3 + `@electron/rebuild` |
| S3 | `OPENCODE_CONFIG_CONTENT` 注入 remote MCP（带 headers）、agent、plugin 生效，且与用户全局配置合并；`--pure` 行为 | `/config` 返回注入内容；模型能调用 MCP 工具 | 改为写临时配置文件 + `OPENCODE_CONFIG` |
| S4 | 单个 `opencode serve` 通过 `directory` 参数在两个 worktree 并发运行会话，互不串目录 | 两会话各自只改自己目录 | 每 worktree 一个 opencode 进程（调整 D09） |
| S5 | 事件流：`/event` 的订阅范围（全局或按目录）、`message.part.updated`、`session.idle`、`session.error`、`permission.updated` 格式；权限回复接口；prompt 的 `agent`/`model`/`system` 字段 | 事件与接口行为记录成 `modules/opencode/README.md` | 适配层按实测调整 |
| S6 | 同一仓库并发 `git worktree add`、各 worktree 内并发提交、主仓库 merge | 用每仓库互斥锁后 50 次并发无 `index.lock` 错误 | — |
| S7 | electron-builder 打包：utilityProcess 入口、opencode 插件资源、迁移文件进包；未签名 .dmg 可在另一台 Mac 运行 | 安装后启动成功 | — |

## M1 · 基础层（1.5 周）

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M1-01 | shared/enums、constants、errors（08 全部） | 枚举有 zod schema；错误码表含 HTTP 状态；单测覆盖 `STATUS_TONE` 完整性（每个状态都有映射） |
| M1-02 | shared/fsm：`defineMachine`、`transition`；8 张转换表（09）；`pnpm gen:fsm-docs` 生成 Mermaid 并校验文档 | 单测：每张表合法/非法转换各覆盖；文档校验脚本在不同步时失败 |
| M1-03 | shared/workflow：`PlanGraph` schema 与 `validatePlanGraph`（全部子码，含 `REQUIRED_STEP_ORDER`） | 单测覆盖每个子码 |
| M1-04a | 操作清单：`defineOperationContract`（shared）、`implement()` 与 Fastify 挂载、统一校验与错误映射、`GET /operations`；以 settings 作为第一个接入的模块 | 集成测试：操作挂载为路由；`risk`/`credentialFields` 缺失时类型报错；`expose.palette` 过滤正确 |
| M1-04 | server core：config、logger（pino）、db（连接、迁移、事务助手）、event-bus、AppError + Fastify 错误处理、令牌认证、zod type provider | 集成测试：未授权 401；校验失败 400 且 details 含 issues；未知异常 500 且日志有堆栈 |
| M1-05 | SSE：事件 id、回放缓冲、`resync` | 集成测试：断线带 Last-Event-ID 能补齐；超出缓冲收到 resync |
| M1-06 | credentials：main safeStorage ↔ utilityProcess MessagePort 加解密；开发环境明文适配器（仅 `NODE_ENV=development`） | 集成测试加解密往返；生产构建中不存在明文适配器代码路径 |
| M1-07 | settings 模块 + API | 未知 key 400；类型错误 400；变更发 `settings.updated` |
| M1-08 | system 模块：环境检测（git、opencode 路径与版本、模型列表占位） | 集成测试用伪造 PATH 覆盖 not_installed / version_mismatch |
| M1-09 | projects 模块 + API（含 checkCommand 推断、远端推断） | 集成测试用临时 Git 仓库；非仓库目录 400 |
| M1-10 | web 框架：路由、布局、导航配置（简单/专业）、API 客户端（类型来自 shared）、Query Provider、SSE 订阅 → 缓存更新 | 切换模式菜单即时变化 |
| M1-11 | 主题：tokens 迁移、四套主题、applyTheme、跟随系统、`base.css` 迁移、对比度单测、`lint:css` | 四主题切换无刷新；对比度测试通过 |
| M1-12 | 通用组件：Button、IconButton、StatusBadge、Panel、Tabs、Dialog、Drawer、Toast、EmptyState、Markdown 渲染、命令面板骨架 | 组件在四主题下的 E2E 截图走查 |
| M1-13 | 页面：引导页、项目列表/详情、设置（简单项） | E2E：引导 → 添加项目 → 切主题 |

## M2 · opencode 托管与 MCP（1.5 周）

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M2-01 | opencode runtime：查找二进制、版本检查、启动/停止/重启、stdout 解析地址、日志落盘、崩溃自动重启一次、运行时状态机 | 集成测试（真实 opencode，标记 `@opencode`）：启动到 ready；kill 进程后自动恢复 |
| M2-02 | 配置生成：MCP、agent（三个基础 agent + bash 预设）、plugin 路径 | 单测：按 `ai.bashPolicy` 生成的权限对象快照（这是允许快照的少数场景：配置对象本身就是产物） |
| M2-03 | opencode-plugin `agent-workflow-bridge`（按 S1 结论） | `@opencode` 集成测试：工具收到 sessionID |
| M2-04 | opencode client 封装：会话创建、prompt_async、abort、权限回复、provider 列表；事件订阅与解析为内部事件 | 仅封装用到的接口；类型来自 SDK 1.19.0 |
| M2-05 | 执行 MCP 服务：挂载 `/mcp/exec`、令牌、工具注册表（归属解析、类型授权、zod 校验、错误映射、hint） | 集成测试用 MCP SDK 客户端：未授权、未归属、类型不允许、参数错误各返回正确 code |
| M2-06 | attempts 模块：创建、状态机、超时、nudge、结束条件（12 §4.2） | 集成测试用 FakeOpencode 覆盖每个结束条件 |
| M2-07 | 会话流：事件 → JSONL 写入 → SSE `attempt.transcript`；transcript 分页 API | 集成测试：流式片段合并正确；分页 afterSeq 正确 |
| M2-08 | MCP 工具：`get_task_context`、`report_progress`、`submit_result`（先接调试节点） | — |
| M2-09 | 运行环境页（专业）+ 侧栏运行指示 + 调试入口（开发构建可见：对指定目录发起一次 execute 尝试） | 手动演示：看到实时会话流 |
| M2-10 | `FakeOpencode`：实现 client 接口，按脚本产生事件与 MCP 调用，供集成与 E2E 测试 | 能脚本化「编辑文件 → 调用 submit_result」「空闲不提交」「提问」「权限请求」「报错」 |

## M3 · 任务主链路·简单模式（2 周）

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M3-01 | roles、workflows 模块；builtin 包（4 角色 5 流程 + 全部提示词）；首启同步与版本化 | 集成测试：内置定义变更产生新版本；内置只读 |
| M3-02 | worktrees 模块：创建/删除、分支命名、每仓库互斥锁、worktree 状态机 | 集成测试：并发创建 5 个任务的 worktree |
| M3-03 | tasks 模块：创建（检查点解析）、start、cancel、retry；任务状态机；task_events | 集成测试覆盖 09 §2 每条转换 |
| M3-04 | plans 模块：`submit_plan` 工具、校验、版本、确认、replan（同会话）、物化节点（`$PROJECT_CHECK` 替换）；fixed 流程模板直接生成计划 | 集成测试：非法计划返回 PLAN_INVALID 且模型修正后通过（FakeOpencode 脚本） |
| M3-05 | scheduler：事件驱动派发、全局与每任务并发上限、依赖满足、失败后停止派发、任务推导事件 | 单测（纯决策函数）+ 集成测试：3 任务 × 并行节点，上限生效 |
| M3-06 | nodes 模块：节点状态机、预算、retryFeedback、完成时自动提交 | 集成测试覆盖 09 §3 每条转换 |
| M3-07 | acceptance：command 检查（超时、输出截断保存）、ai_review（review 尝试 + `submit_review`） | 集成测试：命令失败 → 重试带反馈 → 第二次通过 |
| M3-08 | inbox 模块：question（`ask_user` 全部分支 + 回答回传会话）、permission（事件 → 条目 → 回复）、plan、failure、delivery；自动 dismiss | 集成测试覆盖 12 §6.7 表格每一行 |
| M3-09 | 重启恢复：interrupted 处理、调度恢复、waiting_input 保持 | 集成测试：模拟进程重启 |
| M3-10 | 结果汇总：review 时生成 `tasks.result`（diff 统计、检查结果、节点摘要合成） | — |
| M3-11 | 页面：主页（开始任务）、任务列表、任务页简单视图（各状态主区域）、进度画布（React Flow + elk）、节点抽屉三页签、结果卡（交付按钮先占位）、需要你处理（浮层 + 页面 + 各 kind 卡片） | E2E（FakeOpencode）：J1–J4（见 07 §5） |
| M3-12 | live 冒烟：真实 opencode + 示例仓库跑 `bugfix` 与 `feature` | `pnpm test:live` 通过（手动触发） |

## M4 · 交付与 Git（1.5 周）

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M4-01 | git 模块：status、branches、log、show、diff、tree、file、fetch 的解析器 | 单测：解析器用真实 git 输出样本；集成测试用临时仓库 |
| M4-02 | 任务 diff API（文件列表 + 单文件）、节点 diff | — |
| M4-03 | delivery：squash / merge / rebase 本地合并、主工作区保护、冲突检测与 abort、成功后清理 | 集成测试：三种策略；冲突；主工作区在目标分支且脏时拒绝 |
| M4-04 | 冲突交给 AI：`request-changes(conflict)` → 后端预合并 → `resolve_conflict` 节点 → 完成时提交合并 | 集成测试（FakeOpencode 修改冲突文件） |
| M4-05 | hosting：`GitHostingProvider`、GitHub、GitLab（含自建 baseUrl）、令牌验证、推送、建 PR/MR | 集成测试用 HTTP 录制/本地假服务（仅这两个外部 API 允许假实现）；live 测试真实仓库 |
| M4-06 | 「让 AI 再改改」：revise 节点 | 集成测试 |
| M4-07 | 界面：diff 组件（文件树 + unified/split + shiki）、结果卡交付交互、冲突交互、项目远端绑定表单 | E2E：J5、J6 |
| M4-08 | Git 管理台（专业）：仓库浏览、分支、提交与 diff、worktree 总览与清理 | E2E 冒烟 |

## M5 · 专业模式（2 周）

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M5-01 | 计划编辑画布：增删节点、连线、字段面板、前端实时校验（shared 校验函数）、保存草稿、确认 | E2E：J7 |
| M5-02 | 暂停调整：pause/resume、只改未开始节点、确认新版本后重新物化 | 集成测试：编辑已开始节点 409 |
| M5-03 | 节点操作：重跑、跳过、中止、人工验收（accept_each_node） | 集成测试 + E2E 冒烟 |
| M5-04 | 完整节点详情页：尝试切换、完整工具输入输出、思考、tokens/成本 | — |
| M5-05 | 流程编排器：列表、复制内置、编辑（fixed 用画布组件；ai 编辑指引/角色/必经步骤）、检查点、默认验收、校验、版本 | E2E：J8 |
| M5-06 | 角色管理：列表、复制、编辑提示词与模型（模型下拉来自 opencode provider 列表） | — |
| M5-07 | 数据库：连接 CRUD、测试连接、schema 浏览、项目关联；`db_list_connections` / `db_describe` / `db_query` 工具 | 集成测试用 docker MySQL：只读拒绝写语句、超时、截断 |
| M5-08 | MCP 工具页、运行环境日志页、设置专业项 | — |
| M5-09 | 开始任务的更多选项（检查点、基线分支、标题、保存草稿） | — |
| M5-10 | ⌘K 命令面板：导航 + 搜索 + `expose.palette` 操作；核对全部操作的 `risk` / `credentialFields` 标注 | E2E 冒烟：⌘K 切换主题、打开任务；单测：所有含凭据的操作都声明了 credentialFields |

## M6 · 打磨与发布（1 周）

| # | 任务 | 完成标准 |
| --- | --- | --- |
| M6-01 | 四主题 × 全部页面走查（Playwright 截图集，人工检查） | 无对比度与溢出问题 |
| M6-02 | 性能：20 节点计划画布、单会话流 5 MB、10 个并发任务 | 画布交互流畅（> 50fps）；会话流首屏 < 300ms；UI 无卡顿 |
| M6-03 | 错误文案全覆盖：每个错误码都有 `copy/errors.ts` 条目 | 单测校验错误码表与文案表键一致 |
| M6-04 | 打包 .dmg（arm64）、应用图标、关于页、版本号；签名与公证（如有证书） | 干净 Mac 上验收标准 1 |
| M6-05 | E2E 全集（Electron 模式）+ live 测试全集 | 全部通过 |
| M6-06 | 按 01 §5 逐条验收，写验收报告 | 9 条全部通过 |
| M6-07 | 文档收尾：README（安装、开发、架构入口）、各文档与代码同步检查 | — |

## v1.1 · 应用助手（约 2 周，v1.0 发布后）

任务概要见 [15-assistant.md §8](15-assistant.md#8-v11-开发任务概要)，届时按本文格式拆分编号 `A-xx`。
