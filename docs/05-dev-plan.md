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

> 状态：**已完成**（2026-10-21），待合并。设计与实现见 [15-assistant.md](15-assistant.md)（§9 为实现结构与测试）。与设计的差异与补充：按保守方案收紧了助手能用的操作（D65）：工具按界面模式过滤（用户已确认）、`settings.update` 的 `assistant.alwaysAllow`、`opencode.binaryPath`、`ai.bashPolicy`、`worktree.rootDir` 不进入助手 schema（契约新增可选字段 `assistantOmit`，用户已确认）、凭据必填的操作（`databases.create`、`projects.setHosting`）只能 `open_form`（待用户确认）；第一批操作中缺少的数据库只读查询补为新操作 `databases.query`；助手面板自己的操作 `expose.assistant = false`。确认先转为 `confirmed` 再执行（防止重复执行），会话忙时结果在本轮结束后送达；助手会话的权限询问在面板中以卡片回复（不进「需要你处理」）；助手写入对话文件目录的文件以新会话流条目 `attachment` 出现，确认卡片为 `confirmation` 条目。执行 MCP 的 Streamable HTTP 挂载移到 `core/http/mcp-endpoint.ts`，会话流存储按主体泛化，两者由助手复用。各 agent 的权限 deny 另一套 MCP 的工具。前端：面板为外壳第三列；对话状态只以 SSE 为准（发送响应可能晚于「本轮结束」事件）。live 冒烟（`opencode-go/deepseek-v4.1-flash`）：调用 `get_current_time` 与 `projects_list`，回复「明天是 2026 年 10 月 22 日（星期四）」与项目名。未验证：opencode 是否每次会话重新读取 MCP 工具列表（15 §3）。

| # | 任务 | 完成标准 |
| --- | --- | --- |
| A-01 | 契约：枚举（确认状态、助手工具名、页面、表单）、常量（助手目录、工具前缀、标题长度）、错误码、确认状态机、助手操作与 DTO、SSE 事件、会话流新增 `confirmation` / `attachment` 两种条目；08 / 09 / 10 / 11 同步 | 单测：确认状态机合法 / 非法转换；`pnpm gen:fsm-docs --check` 通过；助手自己的操作 `expose.assistant = false` |
| A-02 | 存储：迁移新增 `assistant_conversations`、`assistant_confirmations`；assistant 模块的对话增删查；消息流 JSONL `assistant/conversations/<id>.jsonl` | 集成测试：新建 → 列表 → 读消息流分页；删除对话同时删除其确认、JSONL 与 `files/<id>/` |
| A-03 | `aw-assistant` agent：注入配置（agent、助手 MCP server、两套 MCP 工具在对方 agent 中 deny）、bridge 插件同时给 `agent-workflow-app_` 工具注入会话 id；会话 `directory = <数据目录>/assistant/`、`external_directory: deny`、bash 用不带检查命令的只读规则、`question: deny`；每轮 `system` 注入时间与时区、界面模式、当前页面与选中对象；对话忙碌状态、会话事件 → 消息流、对话中的权限请求 | 单测：配置快照；集成测试（FakeOpencode）：发送消息时会话的目录、agent、规则与 `system` 内容正确（含选中任务的编号与标题），忙碌时再发返回 `ASSISTANT_BUSY`，权限请求在对话中回复后会话继续；`@opencode` 测试：注入后 `aw-assistant` 与 `agent-workflow-app` 在 opencode 中可见且 MCP 已连接 |
| A-04 | 助手 MCP `/mcp/assistant`（独立令牌）：从操作清单生成工具（`expose.assistant`、按界面模式过滤、名称 `.` → `_`、剔除凭据字段、凭据字段必填的操作不生成）；会话归属；风险拦截：read 直接执行，write 需确认（`assistant.alwaysAllow` 中的直接执行），critical 每次确认；确认 / 取消后由后端执行并把结果作为下一条消息发回同一会话（会话忙时等空闲再发）；助手不能修改 `assistant.alwaysAllow`、`opencode.binaryPath`、`ai.bashPolicy`、`worktree.rootDir`（D65） | 集成测试（MCP SDK 客户端 + FakeOpencode）：read 直接返回结果；write → `needs_confirmation` → 确认后操作生效且会话收到结果消息；write 在总是允许中时直接执行；critical 不能设为总是允许（400）且总是允许列表中的 critical 仍需确认；取消后会话收到取消消息；工具 schema 中没有 `password` / `token`；未归属的会话（执行会话）调用返回 `MCP_CONVERSATION_UNRESOLVED` |
| A-05 | 助手专用工具：`get_current_time`、`get_app_status`、`open_page`、`open_form`（凭据字段不在 schema 中，预填凭据被拒绝）、`list_files`、`reveal_file`（路径限定在对话的 `files/<id>/`）；补齐第一批操作中缺的数据库只读查询 `databases.query` | 集成测试：时间与时区正确（FakeClock）；`open_page` / `open_form` / `reveal_file` 推送对应 SSE 事件；`open_form` 带 `password` 返回 `VALIDATION_FAILED`；`reveal_file` 越界路径返回 `VALIDATION_FAILED`；`databases.query` 拒绝写语句（Docker MySQL） |
| A-06 | 界面：⌘J 侧边面板（对话列表新建 / 切换 / 删除、消息流、工具调用折叠一行、确认卡片、权限卡片、文件附件卡片、`⌘↵` 发送、`Esc` 收起）；`open_page` / `open_form` 在面板旁导航（面板保持打开），表单预填非敏感字段；`reveal_file` 经 preload 在 Finder 中显示 | E2E 冒烟：⌘J 打开面板、发送消息、显示回复；`open_page` 后页面跳转且面板仍打开 |
| A-07 | 主页顶部助手输入框（回车打开面板并开始新对话，与结构化「开始任务」并存）；设置页「助手」分组：查看与撤销「总是允许」 | E2E：主页输入 → 面板中出现新对话；卡片上「总是允许」后设置页列出该操作，撤销后消失 |
| A-08 | E2E（FakeOpencode）：对助手说开始任务 → 确认卡片 → 任务运行；四主题走查加入助手面板 | `pnpm e2e` 通过，走查截图含助手面板 |
| A-09 | live 冒烟（真实 opencode + 默认模型 `TEST_MODEL`）：让助手查明天的日期、列出项目 | `live/assistant.live.test.ts` 通过：回复包含明天的日期与示例项目名，会话中调用了 `get_current_time` 与 `projects_list` |
| A-10 | 文档收尾：15 与实现对齐、03 / 12 / 14 中的助手部分、本节状态段 | 文档与代码一致；`pnpm verify`、`pnpm e2e`、`pnpm test:oc` 通过 |
