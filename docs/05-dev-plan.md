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

> 状态：**已完成**（2026-10-19）。与计划的差异：环境检测中的模型列表为占位（`ready` 暂不要求模型，M2-04 接入）；项目的远端绑定接口（`PUT/DELETE /projects/:id/hosting`）随 M4-05、删除时的活动任务检查随 M3-03 加入；命令面板为骨架（页面、切主题、切模式、`expose.palette` 中能直接执行的操作），M5-10 补全；主页「开始任务」与任务、需要你处理页面为占位，随 M3-11 实现。未引入 `fastify-type-provider-zod`（D39）。

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

> 状态：**已完成**（2026-10-19）。与计划的差异：执行 MCP 工具先接**调试尝试**（开发构建的调试入口，不属于任务，D40），任务 / 节点归属随 M3 加入；`attempts` 的 `task_id` / `node_id` / `role_id` 外键随 M3 的迁移加上；结束条件中「空闲且有未回答的阻塞问题」随 `ask_user`（M3-08）实现；`report_progress` 的进展记在活动尝试上（D41）；`RuntimeDTO` 不含活动会话数；`/system/runtime/logs` 随 M5-08；会话流暂不产生 `file_edit` 条目（编辑以工具调用出现）。`glm-5.3-flash-free` 免费额度用尽，`@opencode` 测试改用 `opencode/beam-free`（D42），bridge 插件测试是唯一调用模型的 `@opencode` 测试。

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

> 状态：**已完成**（2026-10-20）。与计划的差异：流程与角色只有读取与修改操作（`PUT` 对内置定义返回只读错误；复制与新建随 M5-05 / M5-06）；暂停 / 恢复、跳过节点、交付与「再改改」不在本里程碑（M4、M5）；任务与 inbox 列表不分页（`limit`）。新增决策 D43–D49；`NODE_ATTEMPTS_EXHAUSTED` 错误码；节点状态机允许 `waiting_input` 经 `attempt_failed` / `interrupted` 离开，尝试状态机允许 `starting` 时中止。

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

> 状态：**已完成**（2026-10-20）。与计划的差异：Git 管理台的任意 ref 比较拆为 `/git/diff`（文件列表）与 `/git/diff/file`（单文件），步骤 diff 另有单文件接口；任务 diff 与结果卡相对任务分支与目标分支的 merge-base（解决冲突合入目标分支后不计入目标分支的改动）；本地合并在目标分支检出的工作区或临时 worktree 中进行，`deliver` 在冲突与失败时也返回任务 DTO（D52）；PR 推送到 `origin`，令牌经环境变量传给 git（D53）；diff 视图自写 + shiki，未引入 `@git-diff-view/react`（D54）；`lastDelivery` 只描述本轮待合并；worktree 路径按 git 的方式存为解析符号链接后的路径。新增错误码 `DELIVERY_TARGET_DIRTY`、`DELIVERY_INTERRUPTED`，枚举 `ChangeRequestReason`。顺带：规划与评审会话可不经询问运行项目检查命令（D51）。托管平台的 live 测试在提供令牌与仓库的环境变量时才验证真实令牌与创建 PR（07 §6）。

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

> 状态：**已完成**（2026-10-20）。与计划的差异与补充：暂停调整只能改动 / 删除 `pending`、`ready` 的节点，确认后按 key 重新物化（就地改写，保留尝试历史；新事件 `deps_unmet` 让多了未完成依赖的 `ready` 节点回到 `pending`），任务保持暂停，`resume` 时未确认的草稿被取代（D55）；计划画布与后端共用 `planEditRules` + `validatePlanGraph` + `lockedChanges`，依赖也可在步骤面板勾选（D56）；`plan_review` 中用户编辑的草稿取代 AI 草稿，「需要你处理」中的确认确认当前草稿。流程与角色的复制、新建、删除随 M5-05 / M5-06：删除由 tasks 模块实现，被任务用过的流程版本保留但不再列出，用过的角色不能删除（D57）；流程定义校验 `validateWorkflowDefinition`（08 §5.4）编辑器与后端共用；新增错误码 `WORKFLOW_ALREADY_EXISTS`、`ROLE_ALREADY_EXISTS`、`DB_CONNECTION_ALREADY_EXISTS`。数据库只读查询另外拒绝可执行注释、`INTO` 与加锁子句，每次访问单独连接（D58）；集成测试用 Docker 中的 MySQL 8.4（`test/helpers/mysql.ts`，`pnpm verify` 需要本机 Docker，镜像先 `docker pull mysql:8.4`）；项目详情加 `dbConnectionIds`，`PUT /projects/:id/db-connections` 由 projects 模块实现。M5-08 新增 `GET /system/runtime/logs` 与 `GET /mcp/tools` 两个操作。M5-10 复核操作标注：`inbox.resolve` 改为 critical、`system.recheckEnvironment` 改为 write（D59），`tasks.create` 进入命令面板（打开主页表单）。任务页的专业视图也可在简单模式下用「显示详细信息」临时打开，完整步骤页两种模式都能访问（D60）。M3 推迟的任务与 inbox 列表分页随本里程碑完成（游标分页，任务页与「需要你处理」页「加载更多」）。E2E 新增 J7、J8、步骤操作冒烟、⌘K 冒烟与「简单模式打开专业页面」。

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

> 状态：**已完成**（2026-10-21），验收报告见 [16-acceptance-v1.0.md](16-acceptance-v1.0.md)。M6-01：走查即 E2E J9（`walkthrough.browser.spec.ts`），四套主题 × 两种模式 39 个页面状态，自动检查 axe `color-contrast` 与横向溢出，截图写到不提交的 `screenshots/walkthrough/`；找出并修复品牌按钮与 `muted` 文字在悬停 / 选中底色上的对比度（主题单测随之扩大），以及若干界面问题；新增依赖 `@axe-core/playwright`。M6-02：`pnpm perf` 实测（生产构建前端 + FakeOpencode），画布 60 fps；5 MB 会话流首屏 1215 → 52 ms（只解析本页的行、先显示第一页、实时行另存合并，`TranscriptPage.hasMore`）；10 并发任务时实时会话流的任务页 48.6 → 54.2 fps。M6-03：`ERROR_COPY` 为 `Record<ErrorCode, string>` 并有单测，前端不再有「通用文案 + 码」的回退。M6-04：图标、设置页「关于」与 macOS 关于面板、版本 1.0.0、`GET /system/health` 进入 11；未签名 dmg，「干净 Mac」以 dmg 挂载副本 + 全新用户数据目录替代（16 §1）。M6-05：J10 用真实 opencode 与免费模型（生产包中没有 FakeOpencode），取代原先的启动冒烟；live 新增 Java + Maven 示例 `java-inventory` 与 `workflows.live.test.ts`，五个内置流程各跑一次；live 用推断的检查命令；只读白名单加入 `echo` 等（D61），只读角色执行的步骤（代码审查）也放行项目检查命令；只读规则收回 `find -exec` / `-delete`、重定向、`rg --pre`、`git --output` 等写入或执行的写法（D63）；调用模型的测试默认模型改为 `opencode-go/deepseek-v4.1-flash`（D62），beam-free 的结果一并保留在 16。M6-06 另新增「三任务并发合并」E2E 与 MCP 纠错 live 测试。托管平台真实令牌、真正的干净 Mac、截图逐张走查、签名与发布需要用户完成；走查测试的一次偶发失败根因未查明，列为未解决的已知问题（16）。

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

> 状态：**已完成**（2026-10-21，PR #9）。设计与实现见 [15-assistant.md](15-assistant.md)（§9 为实现结构与测试）。与设计的差异与补充：按保守方案收紧了助手能用的操作（D65，**待用户确认**）：工具按界面模式过滤、`settings.update` 的 `assistant.alwaysAllow` 与 `opencode.binaryPath` 不进入助手 schema（契约新增可选字段 `assistantOmit`）、凭据必填的操作（`databases.create`、`projects.setHosting`）只能 `open_form`；第一批操作中缺少的数据库只读查询补为新操作 `databases.query`；助手面板自己的操作 `expose.assistant = false`。确认先转为 `confirmed` 再执行（防止重复执行），会话忙时结果在本轮结束后送达；助手会话的权限询问在面板中以卡片回复（不进「需要你处理」）；助手写入对话文件目录的文件以新会话流条目 `attachment` 出现，确认卡片为 `confirmation` 条目。执行 MCP 的 Streamable HTTP 挂载移到 `core/http/mcp-endpoint.ts`，会话流存储按主体泛化，两者由助手复用。各 agent 的权限 deny 另一套 MCP 的工具。前端：面板为外壳第三列；对话状态只以 SSE 为准（发送响应可能晚于「本轮结束」事件）。live 冒烟（`opencode-go/deepseek-v4.1-flash`）：调用 `get_current_time` 与 `projects_list`，回复「明天是 2026 年 10 月 22 日（星期四）」与项目名。未验证：opencode 是否每次会话重新读取 MCP 工具列表（15 §3）。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| A-01 | 契约：枚举（确认状态、助手工具名、页面、表单）、常量（助手目录、工具前缀、标题长度）、错误码、确认状态机、助手操作与 DTO、SSE 事件、会话流新增 `confirmation` / `attachment` 两种条目；08 / 09 / 10 / 11 同步 | 单测：确认状态机合法 / 非法转换；`pnpm gen:fsm-docs --check` 通过；助手自己的操作 `expose.assistant = false` |
| A-02 | 存储：迁移新增 `assistant_conversations`、`assistant_confirmations`；assistant 模块的对话增删查；消息流 JSONL `assistant/conversations/<id>.jsonl` | 集成测试：新建 → 列表 → 读消息流分页；删除对话同时删除其确认、JSONL 与 `files/<id>/` |
| A-03 | `aw-assistant` agent：注入配置（agent、助手 MCP server、两套 MCP 工具在对方 agent 中 deny）、bridge 插件同时给 `agent-workflow-app_` 工具注入会话 id；会话 `directory = <数据目录>/assistant/`、`external_directory: deny`、bash 用不带检查命令的只读规则、`question: deny`；每轮 `system` 注入时间与时区、界面模式、当前页面与选中对象；对话忙碌状态、会话事件 → 消息流、对话中的权限请求 | 单测：配置快照；集成测试（FakeOpencode）：发送消息时会话的目录、agent、规则与 `system` 内容正确（含选中任务的编号与标题），忙碌时再发返回 `ASSISTANT_BUSY`，权限请求在对话中回复后会话继续；`@opencode` 测试：注入后 `aw-assistant` 与 `agent-workflow-app` 在 opencode 中可见且 MCP 已连接 |
| A-04 | 助手 MCP `/mcp/assistant`（独立令牌）：从操作清单生成工具（`expose.assistant`、按界面模式过滤、名称 `.` → `_`、剔除凭据字段、凭据字段必填的操作不生成）；会话归属；风险拦截：read 直接执行，write 需确认（`assistant.alwaysAllow` 中的直接执行），critical 每次确认；确认 / 取消后由后端执行并把结果作为下一条消息发回同一会话（会话忙时等空闲再发）；助手不能修改 `assistant.alwaysAllow` 与 `opencode.binaryPath`（D65） | 集成测试（MCP SDK 客户端 + FakeOpencode）：read 直接返回结果；write → `needs_confirmation` → 确认后操作生效且会话收到结果消息；write 在总是允许中时直接执行；critical 不能设为总是允许（400）且总是允许列表中的 critical 仍需确认；取消后会话收到取消消息；工具 schema 中没有 `password` / `token`；未归属的会话（执行会话）调用返回 `MCP_CONVERSATION_UNRESOLVED` |
| A-05 | 助手专用工具：`get_current_time`、`get_app_status`、`open_page`、`open_form`（凭据字段不在 schema 中，预填凭据被拒绝）、`list_files`、`reveal_file`（路径限定在对话的 `files/<id>/`）；补齐第一批操作中缺的数据库只读查询 `databases.query` | 集成测试：时间与时区正确（FakeClock）；`open_page` / `open_form` / `reveal_file` 推送对应 SSE 事件；`open_form` 带 `password` 返回 `VALIDATION_FAILED`；`reveal_file` 越界路径返回 `VALIDATION_FAILED`；`databases.query` 拒绝写语句（Docker MySQL） |
| A-06 | 界面：⌘J 侧边面板（对话列表新建 / 切换 / 删除、消息流、工具调用折叠一行、确认卡片、权限卡片、文件附件卡片、`⌘↵` 发送、`Esc` 收起）；`open_page` / `open_form` 在面板旁导航（面板保持打开），表单预填非敏感字段；`reveal_file` 经 preload 在 Finder 中显示 | E2E 冒烟：⌘J 打开面板、发送消息、显示回复；`open_page` 后页面跳转且面板仍打开 |
| A-07 | 主页顶部助手输入框（回车打开面板并开始新对话，与结构化「开始任务」并存）；设置页「助手」分组：查看与撤销「总是允许」 | E2E：主页输入 → 面板中出现新对话；卡片上「总是允许」后设置页列出该操作，撤销后消失 |
| A-08 | E2E（FakeOpencode）：对助手说开始任务 → 确认卡片 → 任务运行；四主题走查加入助手面板 | `pnpm e2e` 通过，走查截图含助手面板 |
| A-09 | live 冒烟（真实 opencode + 默认模型 `TEST_MODEL`）：让助手查明天的日期、列出项目 | `live/assistant.live.test.ts` 通过：回复包含明天的日期与示例项目名，会话中调用了 `get_current_time` 与 `projects_list` |
| A-10 | 文档收尾：15 与实现对齐、03 / 12 / 14 中的助手部分、本节状态段 | 文档与代码一致；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.1 · 知识问答

> 状态：K-01…K-11 **已完成**（2026-10-21，PR #12）；K-12…K-15（流式回答与模型选择，用户 2026-10-22 确认 D67 / D69 后）**已完成**（PR #13）：live（`deepseek-v4.1-flash`）三次通过，回答先以正文流式写出、与提交的回答一致（首次模型直接提交、没有草稿，首条消息改为写明两步顺序后正常）。设计见 [18-knowledge.md](18-knowledge.md)；需要用户拍板的取舍为 D67–D69（**待用户确认**），实现按保守方案：对话固定项目、资料范围与模型（默认模型），续问沿用同一 opencode 会话；回答在引用校验通过后一次出现；研究员不提问；提问与续问为 read（用户确认），助手提问后异步收到回答（K-11）；研究不计入调度并发。与设计的补充：尝试接受调用方预先给定的 id（轮次行与尝试行在同一同步段写入，会话最早的 MCP 调用也找得到这一轮）；会话级规则改为选项对象 `{ checkCommands, web }`；对话 DTO 带项目的 `repoPath`（研究过程中的路径相对它显示）；FakeOpencode 新增 `tool` 步骤（只读的原生工具调用）。live（`opencode-go/deepseek-v4.1-flash`，`ts-stats`）：一次通过，约 111 秒，3 处引用（`src/stats.ts` 第 8–13 行、测试与 README），没有权限请求；模型先试了 `get_task_context`（被拒绝），研究员协议提示词随后写明任务工具不可用。发现但未处理：`tasks.changes.int.test.ts` 的冲突用例在整套集成测试并发时偶发 5 秒超时，基线分支同样出现（单独运行 1.5 秒通过）。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| K-01 | 契约：枚举（`KnowledgeTurnStatus`、`CitationType`、`KnowledgeSourceKind`、`CitationProblemCode`、`AttemptKind.research`、`SessionAgent`、`McpToolName.SubmitAnswer`、`knowledge.updated` 事件）、常量与限制值、错误码、`citationMarkers` / `classifySource`、DTO、`submit_answer` schema、知识操作契约；08 / 10 / 11 / 12 同步 | 单测：`citationMarkers`（链接、代码块、行内代码不算）、`classifySource`、`knowledgeTurnStatusOf`；`STATUS_TONE` 覆盖新状态；`ERROR_COPY` 覆盖新错误码；知识操作的风险与暴露标注 |
| K-02 | 存储：迁移 `0009_knowledge`（两张表）；repo；尝试模块支持预先给定 id、`research` 会话流目录 `runs/knowledge/`、按 id 删除尝试及其会话流 | 集成测试：新建对话 → 列表 → 详情；删除对话同时删除轮次、尝试与会话流文件 |
| K-03 | `aw-researcher` agent（配置注入：edit / question / webfetch / websearch / task deny，助手工具 deny）；会话级规则：`readonlyBashRules()` + 网络开关；尝试的 `agent` 扩为 `SessionAgent`；提示词 `protocol-research.md`、`start-research.md`、`research-followup.md` | 单测：配置快照；会话规则（开关关：无 web allow；开：两条 allow 在最后）；`@opencode`：注入后 `aw-researcher` 可见 |
| K-04 | knowledge 服务：提问（`ask`）、续问（同一会话 `continueSession`）、停止、删除、列表（搜索、项目、游标分页）、详情（`awaitingInput`）；尝试结束的反应与 `knowledge.updated`；删除项目时检查研究中的对话并级联 | 集成测试（FakeOpencode）：会话目录为项目仓库、agent 与规则正确；续问发到同一 opencode 会话；研究中续问 / 删除返回 `KNOWLEDGE_CONVERSATION_BUSY`；停止 → `stopped`；未提交 → 提醒 → `failed`；删除项目时研究中拒绝 |
| K-05 | `submit_answer` 工具与引用校验（路径越界含 `..` / 符号链接 / `.git`、文件不存在、行号越界、区间过长、来源不在范围、未知连接、非只读 SQL、未知标注、未用引用），一次返回全部问题 + hint；数据库工具支持 `research` 尝试 | 集成测试（MCP SDK 客户端）：每个子码一次且带 hint；修正后重提成功、轮次 `answered`、`excerpt` 正确；`research` 调用 `submit_result` / `ask_user` 为 `MCP_TOOL_NOT_ALLOWED`；范围不含数据库时 `db_list_connections` 为空 |
| K-06 | 原文读取 `knowledge.citation`：文件窗口与 `changed`、读取时再检查路径、数据库只读重新执行、网页 | 集成测试：窗口与高亮区间正确；改动后 `changed`；删除文件后 `KNOWLEDGE_SOURCE_UNAVAILABLE`；编号越界 `KNOWLEDGE_CITATION_NOT_FOUND`；数据库引用返回行（Docker MySQL） |
| K-07 | 界面：`/knowledge` 首屏（项目、输入框、资料来源弹层与网络开关、示例问题）、对话（研究过程卡与阶段推导、回答与引用上标、引用卡、停止 / 重新提问、等待你允许）、原文面板（推入、高亮、上一处 / 下一处、`Esc`）、专业视图（会话流、模型与用量）；侧栏菜单；四套主题 | 单测：`researchSteps`；E2E 冒烟见 K-09 |
| K-08 | 界面：`/knowledge/history` 对话记录（搜索、项目筛选、今天 / 昨天 / 更早分组、摘要与状态、加载更多、删除确认、空与错误态） | E2E 见 K-09 |
| K-09 | E2E（FakeOpencode）：J12「提问 → 研究过程 → 带引用的回答 → 点击引用看原文 → 续问 → 对话记录」；J9 走查加入知识问答 | `pnpm e2e` 通过，走查截图含知识问答首屏、回答 + 原文面板、对话记录 |
| K-10 | live（真实 opencode + `TEST_MODEL`）：对 `ts-stats` 提有确定答案的问题；文档收尾（03、07、14、本节状态段） | `live/knowledge.live.test.ts` 通过：回答带有效引用且指向正确的文件；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |
| K-11 | 应用助手调用知识问答（18 §4a）：提问与续问为 read 并声明 `produces: knowledge_conversation`；工具立即返回 `researching`，这一轮结束后带引用的回答（或错误）与导航卡片作为下一条消息发回助手会话；助手面板中的应用内链接（引用、对话页）在面板旁打开；`AssistantPage` 加入知识问答页面 | 集成测试：立即返回 `researching`、回答消息含引用与链接、导航卡片、失败路径；E2E J13 |
| K-12 | 契约：`ask` / `followUp` 的可选 `model`；轮次 DTO 与列表摘要的 `model`；常量 `KNOWLEDGE_DRAFT_FLUSH_CHARS`（D104 起删除，所有尝试按 32 个字符写增量行）；`answerDraft(entries)`；02 D67 / D69 确认 | 单测：`answerDraft`（工具调用之间的说明不算草稿、`submit_answer` 之后不截断） |
| K-13 | 后端：研究尝试的流式正文按 `KNOWLEDGE_DRAFT_FLUSH_CHARS` 写会话流；每一轮按请求的模型（或 `ai.defaultModel`）发起，续问可换模型（`continueSession` 带模型）；研究员协议提示词改为先写正文再提交 | 集成测试：草稿在提交前以细粒度出现在会话流中、提交后轮次 `answered` 且回答为提交的正文；校验失败后仍在研究、草稿保留；停止后草稿保留；两轮不同模型各自记录并随消息发送 |
| K-14 | 界面：草稿流式显示、编号「待核对」不可点击、校验通过后替换为可点击引用、停止时「已停止，引用未核对」；输入框角落的模型选择（首屏与续问），每一轮与对话记录显示模型 | 单测见 K-12；E2E 见 K-15 |
| K-15 | E2E：正文流式出现、编号先待核对后可点击、换模型续问后对话与对话记录显示对应模型；live：默认模型一次流式问答冒烟 | `pnpm e2e`、`pnpm test:oc` 通过；live 通过 |

## v1.1 · Windows 与 Linux

> 状态：**已完成**（2026-10-21，PR #10）。设计见 [17-cross-platform.md](17-cross-platform.md)，决策 D71–D76。验收：三平台 CI（`.github/workflows/ci.yml`）全绿 + 本机 macOS `pnpm verify`、`pnpm e2e`、`pnpm test:oc`、`pnpm e2e:smoke`；Windows 与 Linux 真机安装与首次引导由用户完成（17 §5）。与计划的差异：`.cmd` 启动与结束进程树用 execa 10 自带的能力（不自写）；浏览器 E2E 改由后端托管构建出的前端（Vite 开发服务器的 HMR 断线重载是 M6 遗留偶发失败的根因，17 §4.1）；合并 main 时把应用助手与知识问答纳入排查（17 §3.9、§3.10）。顺带修复的根因缺陷：冲突预合并缺少提交者身份、知识引用对 CRLF 文件带 `\r`、研究过程在 Windows 上显示绝对路径、助手确认卡片与对话状态在首次读取进行中到达时丢失。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| X-01 | 设计文档 17、任务拆分、决策 D71–D76；仓库 `.gitattributes`（`* text=auto eol=lf`） | 文档评审通过；Windows 检出后 `pnpm check` 不因换行失败 |
| X-02 | 后端平台模块 `core/platform.ts`：`envValue`（Windows 不区分大小写）、`pathDirs`、`homeDir`、`findExecutable`（`.exe` / `.cmd`）、`fromGitPath`、`gitPlatformArgs`、`gitBashOf`；`.cmd` 的启动与结束进程树用 execa 10 自带的能力（Windows 命令解析、`killDescendants`）；业务代码不出现 `process.platform` | 单测覆盖纯函数（以 `path.win32` / `path.posix` 参数化，不依赖运行平台）；`grep process.platform packages/server/src` 只有该文件 |
| X-03 | opencode 查找与托管：Windows 上 `opencode.exe` / `opencode.cmd`、`%USERPROFILE%\.opencode\bin`；停止与重启时结束进程树；应用退出时 main 请后端先停止 opencode（`backend.shutdown`） | 系统集成测试（伪造 PATH 与主目录）在三平台通过：未安装、版本不符、PATH 中找到、主目录中找到、设置路径优先 |
| X-04 | Windows 上 opencode 的 shell 固定为 Git Bash（注入配置 `shell`）；找不到 Git Bash 时 Git 检测未就绪、opencode 不启动 | 配置快照含 / 不含 `shell` 两种；17 §3.3 写明依据（opencode 1.19.0 源码） |
| X-05 | 检查命令：POSIX shell（Windows 上 Git Bash）、注入时钟计时、超时与中止结束进程树 | 集成测试：超时（FakeClock）与中止都结束命令且结果为未通过；三平台 CI 通过 |
| X-06 | git：读取路径的入口规范化（`readRepoRoot`、`listWorktrees`）；Windows 上 `core.longpaths` | 项目、worktree、交付、Git 管理台的集成测试在 Windows CI 上通过（不改断言） |
| X-07 | 凭据：Linux 上 `basic_text` / `unknown` 后端视为不可用；credential port 新增 `status`；`EnvironmentDTO.credentials`；引导页「凭据存储」警告项 | 单测：后端名称 → 可用性；集成测试：环境检测报告凭据可用性；E2E 引导页不受影响 |
| X-08 | 引导页与文案按平台：`EnvironmentDTO.platform`、安装命令、opencode 路径示例、设置说明；快捷键显示 ⌘ / Ctrl | 每个平台都有文案（`satisfies Record<Platform, …>`，由类型检查保证）；浏览器 E2E 在三平台通过 |
| X-09 | 打包：electron-builder 增加 win nsis x64、linux AppImage + deb x64、`icon.png`、维护者与可执行文件名；`pnpm dist` 构建当前平台 | CI 在 windows 与 ubuntu 上打出安装包并上传 artifact |
| X-10 | CI：GitHub Actions 三平台矩阵（verify 各步骤、浏览器 E2E、Electron 启动冒烟，Linux 用 xvfb）；数据库集成测试只在 ubuntu 运行并写明原因 | 三平台全绿 |
| X-11 | 文档收尾：03 §7 数据目录、11 环境接口、07 CI 与 Electron 冒烟、14 引导页、README 各平台安装、本节状态 | 文档与代码一致 |
## v1.1 · 质量与用量

> 状态：**已完成**（2026-10-21，PR #17）。设计见 [19-insights.md](19-insights.md)；决策 D79（只统计 tokens，不统计成本）与 D80（自写柱状图）用户已确认。验收：本机 macOS `pnpm verify`、`pnpm e2e`（含 J16 与走查 J9）、`pnpm test:oc` 通过；性能实测见 19 §5。与计划的差异：用户确认后去掉了成本（原设计按 opencode 报告的美元成本统计，并把未报价格的用量标为「未计价」）；趋势图为 HTML/CSS 柱状图；两种模式默认都看本周。顺带修复的根因缺陷：FakeOpencode 的 `abort()` 同步生效，提交结果那一步的用量永远报不上来（opencode 在工具结果之后紧接着发 step-finish，早于我们的中止请求）；跳过午夜的夏令时时区（哈瓦那）一天的起点算到了前一天（PR #17 评审）。恢复工作台、快照评审、历史归档不做见 D77。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| I-01 | 设计文档 19、任务拆分、决策 D79–D80；14 路由表、11 API、10 索引、08 枚举与常量、07 E2E 旅程同步 | 文档评审通过 |
| I-02 | shared：`InsightsPeriod` / `InsightsDimension` / `InsightsFailureKind` / `InsightsDrill`、`INSIGHTS_MAX_DAYS`、`AssistantPage.Insights`；契约 `insightsQuerySchema`、`InsightsSummaryDTO`、`InsightsTaskDTO`；操作 `insights.summary`、`insights.tasks`（read、`mode = simple`、`expose.assistant = true`） | `pnpm check` 通过；操作标题文案完整（已有单测） |
| I-03 | 后端纯函数：`insights.period.ts`（时间段 → 日期与区间、时刻 → 日期，时区参数化）、`insights.aggregate.ts`（19 §2 全部口径） | 单测：五种时间段与校验、跨时区归日、夏令时；空数据、没有用量的尝试、中断不计、失败原因、按假设的提问、中位数、拆分空键 |
| I-04 | 后端：迁移 `0010_insights`（`attempts(started_at)`、`inbox_items(created_at)`）；`insights.repo.ts`（按区间与按任务 id 批量查询）、service、operations、装配；FakeOpencode 新增 `usage` 步骤（本回合报告的 tokens） | 集成测试：真实流程（首次通过、检查失败后重试且有一次提问、取消、知识问答）后两个操作的数字；`custom` 缺日期 400；性能实测数字记入 19 §5 |
| I-05 | 助手：`open_page` 的 `insights` 页面；助手可调用 `insights_summary` | 集成测试：助手会话调用 `insights_summary { period: 'week' }` 直接返回用量 |
| I-06 | 界面：路由 `/insights`、导航（两种模式）、图标 `chart`；简单视图三张卡；专业视图工具条、用量卡、自写 HTML/CSS 的 tokens 柱状趋势图（令牌着色）、拆分标签页、质量卡、失败原因、任务明细与钻取（`?period&from&to&drill&key`） | 单测：钻取过滤；四主题 `lint:css` 通过 |
| I-07 | E2E J16 `task-insights.browser.spec.ts`：造任务后简单与专业视图的数字、钻取到任务页、四主题切换；走查 J9 包含该页 | `pnpm e2e` 通过 |
| I-08 | 收尾：本节状态、`pnpm verify`、`pnpm e2e`、`pnpm test:oc` | 三条命令通过 |

## v1.1 · 固定模板批量任务

> 状态：B-01…B-10 **已完成**（2026-10-21，PR #19）。设计见 [20-batch-tasks.md](20-batch-tasks.md)，决策 D85（批次的边界）、D86（批量交付），其中子任务不确认计划、目标为任意文本且上限 20、批量交付不支持 PR 三项按保守方案实现，用户 2026-10-22 确认。与设计的补充：批次摘要用 `ended`（终态任务数）而不是布尔的「已结束」，进度条与「已全部结束」都由它得出；任务服务新增 `summariesOf(ids)` 与 `lastDelivery(id)` 供批次读取；助手面板的导航卡片显示批次进度。未做：助手页面类型 `AssistantPage` 没有加入批量页面（用户在批量视图中提问时助手视为未知页面，20 §8）。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| B-01 | 设计文档 20、任务拆分、决策 D85 / D86 | 文档评审通过 |
| B-02 | 契约：`EntityKind.Batch`、`BatchDeliveryOutcome`、常量（`BATCH_TARGET_PLACEHOLDER`、`BATCH_KEY_PREFIX`、`BATCH_TARGETS_MAX`、`BATCH_TARGET_MAX_CHARS`）、错误码 `BATCH_NOT_FOUND`、`renderBatchRequirement` / `batchCounts` / `isBatchDeliverable`、批次 schema 与 DTO、四个操作契约（`batches.create` 为 write 并声明 `produces`，`batches.deliver` 为 critical）；08 / 10 / 11 同步 | 单测：三个函数；创建请求 schema 拒绝无占位符、重复目标、换行目标、替换后超长的需求；`ERROR_COPY` 覆盖新错误码；操作风险与 `produces` 标注 |
| B-03 | 存储：迁移 `0011_batches`（`batches`、`batch_tasks`）；batches 模块的 repo（插入、按 id 读、分页列表、子任务关联） | 集成测试见 B-04；删除项目后批次随之消失 |
| B-04 | 批次服务：创建（只用固定流程、分支检查一次、一个事务写入批次与全部子任务草稿、提交后依次开始；任务创建拆为「检查」与「写入草稿」两步）、详情（子任务摘要与本轮交付）、列表（汇总计数、游标分页） | 集成测试（FakeOpencode + 真实 Git）：创建 3 个目标的批次后各子任务各自有分支与 worktree、各自跑完到待合并、需求为模板替换结果、计划不需确认；AI 规划流程 400 `VALIDATION_FAILED`；不存在的批次 404 `BATCH_NOT_FOUND`；删除项目级联删除批次 |
| B-05 | 批量交付：按目标顺序逐个 `tasks.deliver`（代码流程用本地合并策略，默认 `delivery.defaultStrategy`；报告流程 `report_only`），冲突 / 失败 / 合并前检查不通过的任务停下并记录原因，其余继续；返回每个任务的结果 | 集成测试：三个任务中一个与主分支冲突，另外两个合并成功（主分支有两次提交）、冲突的留在 `review` 且 `lastDelivery.status = conflict`，再次批量交付不包含它；报告流程（`code_review`）批量「完成」 |
| B-06 | 助手：`batches.create` 经确认后创建并出现批次导航卡片；`entity-routes.ts` 加入批次 | 集成测试（MCP SDK 客户端）：`batches_create` → `needs_confirmation` → 确认后批次存在、对话消息流有 `entity_ref`（kind `batch`） |
| B-07 | 界面：新建批量任务页（项目、固定流程、需求模板与默认模板、目录树勾选 / 按行输入、预览、⌘↵ 创建）；主页流程卡片「批量」；流程页「批量运行」 | 单测：目标文本解析（空行、首尾空白）；E2E 见 B-09 |
| B-08 | 界面：批量视图（进度汇总、逐个状态与进展、冲突 / 失败标注、合并全部待合并的 + 确认对话框、结果提示）、批量任务列表 `/batches`、主页「批量任务」区、任务列表入口；四套主题 | E2E 见 B-09；走查截图含新建页与批量视图 |
| B-09 | E2E（FakeOpencode）：J17 主页「补单元测试」的「批量」→ 选 3 个目录 → 创建 → 三个任务到达待合并 → 合并全部 → 主分支 3 个提交、全部已完成；J9 走查加入批量页面 | `pnpm e2e` 通过 |
| B-10 | 文档收尾：03（模块分层）、07（J17）、14（路由与主页）、本节状态段 | 文档与代码一致；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.2 · PR 审查意见回流

> 状态：R-01…R-06 **已完成**（2026-10-22，PR #24）。设计见 [21-review-feedback.md](21-review-feedback.md)，决策 D87（取回与勾选）、D88（修改后由用户推送）、D89（不回写平台），均按保守方案实现，用户 2026-10-22 确认。没有新表与迁移。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| R-01 | 设计文档 21、决策 D87–D89 | 文档评审通过 |
| R-02 | 契约：`ChangeRequestReason.Review`（`request-changes` 仍只接受 user / conflict）、`ReviewCommentKind`、错误码 `PULL_REQUEST_NOT_OPEN` / `BRANCH_DIVERGED`、任务事件 `review_feedback`（`completed → running`）、worktree 事件 `restore`（`removed → creating`）、`TaskDetailDTO.pullRequest`、`ReviewCommentsDTO`、操作 `tasks.reviewComments`（read）与 `tasks.reviseFromReview`（write）；08 / 09 / 11 同步 | `ERROR_COPY` 与操作文案覆盖新增项；状态机文档由 `gen:fsm-docs` 生成 |
| R-03 | 托管平台：按分支查找打开的 PR/MR；读取审查意见（GitHub GraphQL `reviewThreads` / 对话评论 / 审查总结，GitLab `discussions`）；FakeHosting 支持这些端点并能扮演审查者 | 集成测试见 R-04 |
| R-04 | 服务：取回意见（默认勾选）、发起修改（重新取回按 id 挑选、抓取并快进分支、分叉即停、重建 worktree、复用「再改改」追加 `review_fix_<n>` 节点）；`pull_request` 交付沿用已打开的 PR | 集成测试（FakeOpencode + FakeHosting + 真实 Git）：GitHub 全流程（审查者在平台提交的建议被快进进来、提示词含勾选的意见与补充说明、推送后仍只有一个 PR 且远端分支有 AI 的修改）；GitLab 意见映射；意见已不在 400、分支分叉 409 且不做改动、PR 关闭 409、本地合并的任务 409 |
| R-05 | 界面：结果卡「审查意见」区（取回、勾选、补充说明、发起修改）、PR 任务待合并时的「推送到 PR」；助手经操作清单可调用两个操作 | E2E 见 R-06 |
| R-06 | E2E J18（`task-review.browser.spec.ts`，开发后端以 `AW_FAKE_HOSTING_*` 启用 FakeHosting）；文档 03 / 07 / 10 / 12 / 13 / 14 | `pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.2 · 定时任务

> 状态：S-01…S-08 **已完成**（2026-10-21，PR #25）。设计见 [22-scheduled-tasks.md](22-scheduled-tasks.md)，决策 D90（预设频率、不开放 cron、系统时区）、D91（只在应用打开时运行、错过的最多补跑一次、上一次没结束就跳过、开不了任务时自动暂停并进「需要你处理」）、D92（只用固定流程、按 key 取最新版本、合并仍需点击、风险等级），三项按保守方案实现，用户 2026-10-22 确认。与设计的补充：时区换算从质量与用量移到 `core/time-zone.ts` 共用；工作流服务新增 `latest(key)`。未做：助手页面类型 `AssistantPage` 没有加入定时任务页面（同批量任务）。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| S-01 | 设计文档 22、任务拆分、决策 D90–D92 | 文档评审通过 |
| S-02 | 契约：`ScheduleStatus` / `ScheduleFrequencyKind` / `ScheduleRunTrigger` / `ScheduleRunOutcome`、状态机 `schedule`（09 §11）、`EntityKind.Schedule`、`InboxKind.ScheduleFailure`、`ServerEventType.ScheduleUpdated`、`SCHEDULE_*` 常量、错误码 `SCHEDULE_NOT_FOUND` / `SCHEDULE_BUSY`、频率 schema 与 DTO、八个操作契约（删除为 critical） | 单测：状态机表；频率 schema 拒绝错误时刻、空星期、重复星期、非约数小时；操作风险标注 |
| S-03 | 存储：迁移 `0012_schedules`（`schedules`、`schedule_runs`）与 repo（状态只经 `updateStatus`） | 集成测试见 S-05 |
| S-04 | 计划时刻：`nextRunAfter`（三种频率、时区、夏令时）与 `foldDueTimes` | 单测：跨天跨周、夏令时跳过的时刻顺延、重复的时刻只运行一次、折叠错过的时刻 |
| S-05 | 服务与检查循环：到点开任务（不确认计划）、跳过、补跑、失败自动暂停 + `schedule_failure` 条目、暂停 / 恢复、立即运行、删除；检查循环最长 60 秒、注入时钟 | 集成测试（FakeClock + FakeOpencode + 真实 Git）：到点开任务并在「需要你处理」待合并；上一次没结束跳过；关闭三天后重开只补跑一次（`missed = 3`）；分支被删 → 失败暂停 + 条目，恢复后条目关闭；暂停期间不运行；AI 规划流程 400；立即运行与 409；删除项目级联 |
| S-06 | 助手：`schedules.create` 确认后出现定时任务导航卡片；确认卡片把频率写成「每周一、三、五 02:00」 | 集成测试（MCP SDK 客户端）：`schedules_create` → `needs_confirmation` → 确认后 `entity_ref`（kind `schedule`） |
| S-07 | 界面：定时任务列表、新建 / 修改页（频率选择器、专业模式的基础分支）、定时任务页（运行记录、补跑说明）；主页流程卡片「定时」、流程页「定时运行」、任务列表入口；「需要你处理」的来源与 `schedule_failure` 卡片；四套主题 | E2E 见 S-08；走查截图含新页面 |
| S-08 | E2E J19 与 J9 走查；文档收尾（03、07、08、10、11、14、15） | `pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |
## v1.2 · PPT 制作

> 状态：P-01…P-10 **已完成**（2026-10-22）。设计见 [23-ppt.md](23-ppt.md)，决策 D93（结构化内容 + 内置版式）、D94（PDF + PowerPoint）、D95（流程与输入）、D96（与助手），用户 2026-10-22 按推荐方案确认。与设计的差异见 23 文首的「实现说明」。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| P-01 | 设计文档 23、决策 D93–D96 | 用户确认 |
| P-02 | 契约：`DeckStatus` / `DeckRunKind` / `DeckMaterialKind` / `SlideLayout`，`AttemptKind.DeckOutline` / `DeckSlides`，`SessionAgent.SlidesWriter`，`EntityKind.Deck`，`ServerEventType.DeckUpdated`，`AssistantPage.Ppt` / `PptDeck`，常量与错误码，`slideContentSchema`（字数上限），`deckStatusOf`，15 个操作契约；08–12 同步 | 单测：`deckStatusOf` 每个状态；操作风险（`decks.delete` 为 critical）与确认卡片字段文案 |
| P-03 | 存储：迁移 `0013_decks`（`decks`、`deck_materials`、`deck_slides`、`deck_runs`）与 repo | 集成测试见 P-05 |
| P-04 | 写作者：agent `aw-slides`（权限同研究员）、`continueSession` 可换 kind、提示词（协议、上下文、大纲、重写大纲、制作、修改）、`submit_outline` / `submit_slide` | 配置快照含 `aw-slides`；`@opencode` 测试中 `aw-slides` 可见 |
| P-05 | decks 服务与操作：创建（资料快照、项目推断、字数上限）、大纲（重写、手改）、制作 / 继续、让 AI 改、手改、恢复上一版、加页 / 移动 / 删除、停止、删除；SSE | `decks.int.test.ts`（FakeOpencode + 真实 Git）：只读会话与资料快照、页数校验、逐页提交（非目标页与超字数被拒）、同一会话、上一版与恢复、停止后继续、制作中 `DECK_BUSY`、空白目录、任务工具不可用、删除与项目删除 |
| P-06 | 渲染：十种版式组件、四套主题的幻灯片调色板、文字放不下时缩小并提示 | 单测：调色板对比度与不透明色、`emphasisRuns`；走查截图含全部版式 |
| P-07 | 界面：列表、新建（资料选择、页数、风格、模型）、工作台（大纲编辑、缩略图栏、预览、这一页、让 AI 改、恢复上一版、加页）、放映、打印视图；任务结果卡 / 知识对话 / 项目详情的「做成 PPT」 | E2E 见 P-09 |
| P-08 | 导出：PowerPoint（pptxgenjs 按需加载，每种版式映射为原生对象与备注页）、PDF（main 隐藏窗口 + `printToPDF` + 保存对话框） | J20 断言 .pptx 的幻灯片与备注；`ppt-export.electron.spec.ts` 断言 PDF 的页数与不存在的 PPT 返回错误 |
| P-09 | 助手：导航卡片（状态实时）、确认卡片中的 PPT 名称、页面上下文（选中的页）、`open_page`；「需要你处理」中 PPT 的权限请求标「PPT」 | 单测：确认卡片字段文案；E2E J20 与 J9 走查 |
| P-10 | E2E J20、J9 走查（列表、新建、大纲、预览、全部版式）、文档收尾 | `pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.2 · 更多数据库

> 状态：**已完成**（2026-10-22，PR #26；SQL Server 截断修复 PR #27）。设计见 [24-databases.md](24-databases.md)；决策 D97（驱动：pg、gaussdb-node、tedious，GoldenDB 复用 mysql2）、D98（SQL Server 的只读方式）、D99（表结构范围与值的表示），用户 2026-10-22 确认。openGauss 默认 sha256 认证下 pg 无法登录，已用容器实测（24 §6）。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| DB-01 | 设计文档 24、决策 D97–D99；容器实测 openGauss 的 sha256 认证（pg 与 gaussdb-node） | 文档评审通过；实测结果写入 24 §6 |
| DB-02 | shared：`DbType` 五个值、`DB_DEFAULT_PORT`；`get_task_context` 的 `databases[].type` 为 `DbType`；操作与 MCP 工具说明按方言 | 类型检查通过 |
| DB-03 | 语句检查按方言（`assertReadOnlySql(sql, type)`）：MySQL、PostgreSQL、T-SQL 的引号与注释词法；T-SQL 关键字拒绝表；知识问答的引用校验按连接类型检查 | 单测：三种方言各自的放行与拒绝 |
| DB-04 | 驱动：`drivers/postgres.ts`（PostgreSQL 与 openGauss 两个实例：只读事务、`statement_timeout`、游标取行、pg_catalog 读表结构）、`drivers/sqlserver.ts`（不提交的事务、`requestTimeout`、流式取行、INFORMATION_SCHEMA 与 sys 视图读表结构）；`DB_DRIVERS` 按类型组装，service 按连接类型取驱动 | 集成测试（真实容器）：PostgreSQL 17.6、openGauss 7（sha256）、SQL Server 2022 的测试连接、表结构、`db_describe`、值的表示、截断、拒绝写入、超时、SQL 错误；GoldenDB 类型在 MySQL 容器上通过 |
| DB-05 | 测试辅助 `test/helpers/db-containers.ts`（取代 `mysql.ts`）：四种容器、镜像缺失时跳过并提示 `docker pull` | 没有可选镜像时对应用例跳过、有提示 |
| DB-06 | 界面：连接对话框的类型选择与说明、端口随类型切换；连接卡片显示类型；测试结果显示服务器版本 | E2E 见 DB-07；J9 走查数据库页无报错 |
| DB-07 | E2E J21（FakeOpencode + PostgreSQL 容器） | `pnpm e2e` 通过 |
| DB-08 | 文档同步：01、03（依赖与扩展点）、07（J21、容器辅助）、08、10、11、12、14、17、README、CI 拉取镜像与排除 | 文档与代码一致；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.2 反馈 · 画布与流程页重设计

> 状态：**已完成**（2026-10-22）。设计见 [26-canvas.md](26-canvas.md)；决策 D105（视图、控件与自写布局）、D106（+ / − 编辑）、D107（流程编辑页以画布为主），用户确认按推荐方案实现。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| C-01 | 设计文档 26、决策 D105–D107、四主题原型截图 | 用户确认 |
| C-02 | 自写分层布局与编辑操作（插入、下一步、并行、接在最后、删除重连），删除 elkjs | 单测：布局与编辑操作 |
| C-03 | 共用画布：控件条、平移边界、适应画布、键盘、端点、三行卡片与概览样式、连线样式与动画 | J9 走查无报错、无对比度与溢出问题 |
| C-04 | 计划编辑器：+ / −、只显示合法操作、撤销重做、工具条；任务页画布填满视口 | J7、J23 通过 |
| C-05 | 流程编辑页：画布为主、步骤 / 流程设置页签、AI 规划流程的形状画布 | J8 通过；单测：形状的依赖与插入位置 |
| C-06 | 文档同步：03、07、14 | `pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.2 · Git 工作台重做

> 状态：**实现完成，待验收合并**（2026-10-22）。设计见 [27-git-workbench.md](27-git-workbench.md)；决策 D108（手动操作的范围、边界与风险）、D109（轻量审查尝试与 `submit_findings`）、D110（三栏界面、只在专业模式、按需 AI 草拟提交信息），用户 2026-10-22 确认。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| GW-01 | 设计文档 27、D108–D110、四主题原型 | 用户确认 |
| GW-02 | 后端 Git 写操作（`git.write.ts`、`git.remote.ts`；`delivery.merge.ts` 的合并按身份参数化）、扩展的读操作（状态、改动、提交详情、日志筛选）、操作契约与风险等级；任务分支与主工作区的边界 | 集成测试（真实 Git 与 bare 远端）：每个写操作的成功路径与特有错误码、用户身份与钩子、钩子拒绝、推送被拒、拉取不能快进、冲突时目标不变、任务分支被拒 |
| GW-03 | 合并任务：系统流程 `system.merge_branch`（`WorkflowKind.System`）、`tasks.merge_source`、准备阶段的预合并 | 集成测试：冲突交给 AI → 解决 → 合并后目标有两边的改动；系统流程不出现在列表 |
| GW-04 | `git-reviews` 模块：表与迁移 `0015_git_workbench`、`git_review` / `commit_message` 尝试、agent `aw-code-reviewer`、MCP `submit_findings` / `submit_commit_message`、提示词 | 集成测试（FakeOpencode）：审查分支、问题校验退回与修正、同项目一次一个、删项目被挡；草拟成功、没有暂存、AI 未提交 |
| GW-05 | 前端：概览卡片、三栏工作台（工具条、左栏、提交列表与图谱、提交详情、审查面板、改动视图、分支视图、对话框）；diff 的问题标记与定位；窗口回到前台时重读主工作区 | 单测：图谱泳道；E2E 见 GW-06 |
| GW-06 | E2E J24（两个用例）与 J9 走查的工作台画面 | `pnpm e2e` 通过 |
| GW-07 | 文档同步：02、03、04、07、08、10、11、12、13、14、README | 文档与代码一致；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## v1.2 之后 · 以助手为主的主页与打开动画

> 状态：**已完成**（2026-10-22）。设计见 [28-home-assistant.md](28-home-assistant.md)；决策 D111（主页以助手为主，一个输入框两种模式）、D112（主页与 ⌘J 面板同一组对话、接力）、D113（打开动画）用户已确认（按推荐方案）。验收：本机 macOS `pnpm verify`、`pnpm e2e`（含 J25 与四主题走查 J9）、`pnpm test:oc`、`pnpm e2e:smoke`（J15）。与设计稿的出入见 28 §7。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| H-01 | 设计文档 28、决策 D111–D113 | 用户确认 |
| H-02 | shared：`AssistantPage` 五个页面、`ui.introAnimation`、`launchPreferencesSchema` 与 `AwBridge.setLaunchPreferences` | 类型检查通过 |
| H-03 | 主页：标语、两种模式的输入框、直接开始、建议、最近对话、工作概览、对话中视图与工作概览栏 | J1、J7、J8、J17、J19 通过 |
| H-04 | 主页与面板的接力：主页上不显示面板、⌘J 聚焦主页输入框、离开与回到主页、助手带用户离开时的视图过渡 | 单测 `panelFollowsUser`；J25 |
| H-05 | 打开动画：`splashHtml`、main 先开窗口并行启动后端、`launch.json`、设置项、后端提前退出的提示 | 单测 `launch.json`；J15；实测写入 28 §5.2 |
| H-06 | 文档同步（01、02、03、07、08、11、14、15）与 J9 走查 | `pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |

## 后续设计 · 统一附件输入（U，设计稿，未实施）

依据 [30-attachments.md](30-attachments.md)，用户本轮仅要求设计。各项当前均为待实施；本节不预填完成日期和测试结果。

| 任务 | 内容 | 完成标准 |
| --- | --- | --- |
| U-00 | 图片解码／尺寸校验、opencode 图片输入与能力字段、认证二进制上传技术验证；解析库与许可登记到 03 | 文字模型、图片模型分别记录实际可用性；确认后锁定依赖，失败不得假称模型已读图 |
| U-01 | 原件／草稿／输入快照／引用存储与迁移、上传状态机、认证内容路由、清理 | 真文件与 SQLite 集成：中断、重启、超限、清理失败、共享引用、越界均符合 30 |
| U-02 | 统一附件条；任务创建与反馈、主页与侧栏助手；项目文件快照 | 刷新／导航不丢草稿；原文件改变不改变已发送内容；长文件名与错误态四主题走查 |
| U-03 | 提示词目录、分页读取、图片能力适配、实际使用记录、助手创建任务的附件范围 | FakeOpencode 检查输入内容；真实模型验证文字与图片路径；他人对话 ID 不可读 |
| U-04 | PDF／DOCX 正文提取与资源限制；U2 解析库验证后登记 03 | 真实夹具验证页码／段落、扫描与加密文件提示、损坏及解压超限，不阻塞主事件循环 |
| U-05 | 知识问答附件引用、PPT 文件资料、浏览器当前页面捕获接入 | 引用回到原快照；原对话删除不破坏复用资料；浏览器部分依赖 B2，其余独立验收 |

## 后续设计 · 需求验收清单（Q，设计稿，未实施）

依据 [31-requirements-checklist.md](31-requirements-checklist.md)，使用现有任务、节点、尝试与验收机制。

| 任务 | 内容 | 完成标准 |
| --- | --- | --- |
| Q-01 | 清单版本、编辑守卫、候选生成尝试及调度额度、创建／采用 UI | 固定／AI 流程皆可；候选不自动改清单；并发编辑和过期候选不覆盖；旧任务不受影响 |
| Q-02 | 不可变 check_runs、证据快照、内容指纹及结果聚合纯函数 | 重试保留证据；并发写入不能通过；内容不变的提交不误失效；跳过不能算通过 |
| Q-03 | 节点映射、执行者自查、逐项 submit_review、命令绑定、结果卡 | 自查不产生 pass；评审遗漏不自动补齐；引用归属和检查结果由后端验证 |
| Q-04 | 人工确认／豁免、「再改改」与只读重新核验、所有交付入口统一守卫 | 必需项阻止交付；人工决定记录原因；批量、报告、PR 更新不绕过；重验受并发与预算约束 |
| Q-05 | 附件版本及浏览器证据接入，契约／错误／指标／测试文档同步 | U1 与 B2 就绪后验证反馈失效和截图回看；浏览器体检不冒充业务验收；真实模型逐项检查 |

实施时修改 08–12 的待实施状态，并在同一变更中更新代码与契约；新增状态图通过生成器产生。本轮不生成迁移、不改 shared 类型、不新增执行用例。

## v1.3 · 内置浏览器与页面预览（B）

> 状态：**B1 已完成**（2026-10-23，分支 `feat/B-browser`；验收：本机 macOS `pnpm verify`、`pnpm e2e`（含 J26 与四主题走查）、`pnpm playwright test browser-host.electron launch.electron --project electron`、`live/browser.live.test.ts` 两个模型都到待合并）。设计见 [29-browser.md](29-browser.md)；决策 D120–D125 用户 2026-10-23 确认；开发前实测 V1–V7 已完成（29 §12）。B2（验收与界面）、B3（助手、知识问答、PPT）在 B1 完成后再拆。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| B-01 | 设计文档 29、D120–D125、开发前实测 V1–V7 | 用户确认；实测结论写入 29 §12 |
| B-02 | shared：枚举（`PreviewState`、`BrowserSessionKind`、`BrowserTabKind`、`ViewportPreset`、`SiteAccess`、`BrowserActionFailure`、`BrowserBlockReason`）、常量、错误码、设置（`preview.*`、`browser.sites`、`browser.loginUrlPatterns`；助手不能改 `browser.sites`）、`previewMachine`、网站规则 `browser/policy.ts`、后端与 main 之间的协议 `contracts/browser-port.ts`、`contracts/mcp/browser.ts`、`contracts/api/previews.ts` | **已完成**：类型检查与单测通过（`urlAccess` / `blockReason`、状态机）；状态机文档由生成器更新 |
| B-03 | **已完成**。`previews` 模块：项目 `preview` 列与迁移 `0016_project_preview`；按包管理器推断（`projects/projects.inference.ts`）；进程（经 `core/platform.ts`，`killDescendants`）；启动、就绪探测、空闲停止、上限淘汰、日志末尾；操作 `previews.get` / `start` / `stop` / `trial` | 单测：推断表（pnpm / npm / yarn × Vite / 其他）、状态机。集成测试（真实进程，注入时钟）：固定的 Node 小服务就绪、启动失败的日志末尾、`setupCommand` 只运行一次、空闲停止、上限淘汰、停止后没有残留进程 |
| B-04 | **已完成**（Electron E2E 用测试宿主 `e2e/fixtures/browser-host` 驱动真实的 `browser.ts`；另加退出时关闭所有标签页）。桌面 main `browser.ts` 与 parentPort 协议：离屏视图（`about:blank` → 挂调试器 → 设视口）、CDP 转发与事件订阅、导航拦截（按规则，不允许的地址交给系统浏览器）、只读拦截（非 GET 请求与 WebSocket，按 `webContentsId`）、去掉 RTC / WebTransport、禁止下载与权限请求、`capturePage`；preload `aw.browser.*` | Electron E2E：离屏标签页的点击与输入；只读网站拦下 POST 与 WebSocket，用户标签页不受影响（V7 的场景） |
| B-05 | **已完成**（动作画面随 B2 的观看界面一起做）。`browser` 模块：`BrowserHost` 接口与两种实现（`electron`；`chromium` 只在开发模式，生产包检查）；会话（预览与网站两个标签页、分区、尝试结束时关闭）；动作层（定位、滚动、等稳定、确认点中、聚焦后输入、弹窗、新窗口、等页面稳定）；快照；登录页检测；截图与动作画面的存放 | 单测：`browser.settle`、点中判断、快照（用录下的真实无障碍树）、登录页规则。集成测试（`chromium` 宿主 + 固定页面）：29 §14 列出的场景 |
| B-06 | **已完成**（完成标准的真实模型一例放在 `live/browser.live.test.ts`：07 规定 `test:oc` 不调用模型）。执行 MCP 的 11 个浏览器工具、按尝试类型授权、错误码与 hint；各协议提示词（plan / execute / review / research）的浏览器说明；会话流的动作文案 | 集成测试（FakeOpencode）：每个工具的成功路径与特有错误码；`pnpm test:oc` 新增一例（29 §13 B1 的完成标准） |
| B-07 | **已完成**（另加网站登录的 4 个操作，E2E J26）。项目设置「页面预览」（推断预填、试运行）；设置「网站」（规则列表、网站登录、退出登录） | E2E：两处设置的保存与试运行；四主题走查截图 |
| B-08 | **已完成**。文档同步：02、03（扩展点、依赖、目录）、07、08、10、11、12、13、14、17 | 文档与代码一致；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |
