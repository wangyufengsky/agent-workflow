# 02 · 已确认决策

每条格式：决策 · 理由 · 日期。新增决策追加到末尾，推翻旧决策时在旧条目标注「已被 Dxx 取代」。

| # | 决策 | 理由 | 日期 |
| --- | --- | --- | --- |
| D01 | 新建项目 `agent-workflow`，不复用旧 `opencode-workflow` 与 `~/IdeaProjects/agent-workflow` 的代码 | 旧项目后端约 70 万行、充斥回执/未知/核对式防御设计，修改成本高于重写 | 2026-10-19 |
| D02 | 桌面 Electron 44；前端 React 19 + TS + Vite（electron-vite 构建）；设计稿页面不直接复用，只复用主题令牌、样式、图标、文案与状态清单 | 设计稿是状态模拟 + 字符串拼 HTML，搬入即技术债 | 2026-10-19 |
| D03 | 流程画布用 React Flow（`@xyflow/react`）+ elkjs 自动布局 | 成熟、可定制节点、分组嵌套 | 2026-10-19 |
| D04 | 四套主题（deepseek / warm / spdb / github-white）做成强类型主题配置，运行时生成 CSS 变量；另加「跟随系统」 | 新增主题只加一个文件 | 2026-10-19 |
| D05 | 后端 Node 24 + TS，运行在 Electron utilityProcess；HTTP 用 Fastify 5；renderer 通过 127.0.0.1 HTTP + SSE 访问 | 后端可脱离 Electron 独立运行，便于测试；同一 HTTP 服务也承载 MCP | 2026-10-19 |
| D06 | 本地存储 SQLite + Drizzle ORM；只追加日志用 JSONL（驱动已由 D30 确定） | 结构化状态与大体量流式日志分离 | 2026-10-19 |
| D07 | 项目数据库用 mysql2，v1 只读 | 用户要求；写操作风险高，后置 | 2026-10-19 |
| D08 | Git 用本机 CLI（execa 封装）；GitHub 用 Octokit，GitLab 用 Gitbeaker，统一 `GitHostingProvider` 接口；每任务一个分支 + worktree | 用户要求；并发隔离 | 2026-10-19 |
| D09 | 每次启动应用托管一个 `opencode serve`（精确 1.19.0），通过 `OPENCODE_CONFIG_CONTENT` 注入本项目 MCP（remote / Streamable HTTP）与基础 agent；一个 opencode 服务通过 `directory` 参数服务所有 worktree | 一个进程即可并发多 worktree，管理简单 | 2026-10-19 |
| D10 | **保留 opencode 原生 edit/bash 工具**，会话 cwd 锁定在任务 worktree，权限由 opencode permission 配置与「需要你处理」审批控制；MCP 只负责流程控制与受控能力（上下文、计划、结果、提问、评审、数据库只读） | 原生工具对模型效果最好；MCP 工具失败返回错误码让模型自我修正 | 2026-10-19 |
| D11 | **不做回执 / UNKNOWN / requestKey 机制**。本地写操作就是同步事务：成功返回新状态，失败返回错误码。唯一的中断态是「尝试 interrupted」，可重试 | 后端和存储都在本机、都是自己的进程，不存在需要核对的未知结果 | 2026-10-19 |
| D12 | v1.0 范围：核心闭环 + 系统页；知识库、PPT、质量用量、归档、恢复工作台等后置 | 用户确认 | 2026-10-19 |
| D13 | v1.0 只验收 macOS（arm64），代码保持跨平台抽象，Windows/Linux 在 v1.1 | 用户确认 | 2026-10-19 |
| D14 | AI 规划用简化版：AI 经 MCP 提交 DAG → （可选）用户确认/编辑/带反馈重新生成，保留历史版本 → 执行；执行中可暂停调整待执行节点 | 用户确认；v5 设计的轮次/候选对照/修订限制过重 | 2026-10-19 |
| D15 | **默认简单模式，专业模式可选开启**。界面复杂度（专业模式开关）与自动化程度（检查点）分开控制 | 用户提出：多数用户不需要管过程 | 2026-10-19 |
| D16 | 合并永远需要用户点击，不提供自动合并 | 全自动执行的安全底线 | 2026-10-19 |
| D17 | AI 遇到不确定时默认「做合理假设并写明」，可改为「停下来问我」 | 简单模式少打扰 | 2026-10-19 |
| D18 | 第一批内置流程：新功能开发、修 Bug、补单元测试、代码审查（只读）、重构 | 覆盖最常见开发场景 | 2026-10-19 |
| D19 | 专业模式为全局开关；任务页另有「显示详细信息」临时查看专业视图 | 简单与灵活兼顾 | 2026-10-19 |
| D20 | 任务启动后**先建 worktree 再规划**（规划者在 worktree 内只读分析代码） | 规划需要读代码，且不能碰用户主工作区；任务全程只有一个工作目录 | 2026-10-19 |
| D21 | 实体生命周期状态机用 `packages/shared` 中的表驱动转换表实现，不引入 XState | 可序列化、可生成状态图、足够简单 | 2026-10-19 |
| D22 | 包管理 pnpm workspace；lint/format 用 Biome；模块边界用 dependency-cruiser 强制 | 业内常用、配置少 | 2026-10-19 |
| D23 | 所有对外功能操作注册进**操作清单**（每项只定义一次：schema、风险等级、暴露范围、凭据字段），REST 与 ⌘K 命令面板从清单派生；v1.0 即落地 | 功能工具化，为助手与对外 MCP 打地基；新增功能不重复写入口 | 2026-10-19 |
| D24 | **应用助手放在 v1.1**：全局侧边面板（⌘J，感知当前页面）+ 主页顶部输入框，与结构化「开始任务」并存；复用托管 opencode（agent `aw-assistant`） | 用户确认；开发任务用结构化入口更可预期 | 2026-10-19 |
| D25 | MCP 分两套：执行 MCP（`/mcp/exec`，绑定尝试）与助手 MCP（`/mcp/assistant`，v1.1，来自操作清单），令牌与权限隔离 | 执行任务的 AI 不应拥有全局管理能力 | 2026-10-19 |
| D26 | 助手生成的文档默认放在应用的助手目录 `<数据目录>/assistant/files/` | 用户确认；不触碰项目仓库 | 2026-10-19 |
| D27 | 助手调用 write 级操作需确认卡片，用户可在卡片或设置中对单个操作选「总是允许」；critical 级（合并、取消、删除）每次都确认且不可设为总是允许 | 用户确认；与 D16 一致 | 2026-10-19 |
| D28 | 凭据（密码、令牌）不经过助手对话：凭据字段不进入助手工具 schema，助手只能打开预填非敏感字段的表单 | 避免凭据发给模型提供方 | 2026-10-19 |
| D29 | TypeScript 锁定 6.0.3（不用 7.x：原生重写版缺少工具链依赖的 JS API）；源码之间用显式 `.ts` 扩展名导入，开启 `erasableSyntaxOnly`（禁用 enum、参数属性、namespace）；Node 24 直接运行 TS 源码（后端开发、脚本、配置文件、utilityProcess），不引入 tsx | M0：配置文件由 Node 直接加载，无扩展名导入失败；原生类型剥离让工具链更少 | 2026-10-19 |
| D30 | SQLite 驱动用 `node:sqlite`（S2 通过：Electron 44.9 内置 Node 24.22，utilityProcess 内可用，WAL、一万行写入、回滚、并发读均正常）；Drizzle 通过约 50 行适配器复用其 better-sqlite3 同步会话，**不用 sqlite-proxy**（异步驱动会让事务内的 await 与其他请求交错） | 免原生编译；真同步事务 | 2026-10-19 |
| D31 | 后端同时托管构建后的前端页面（同源），renderer 一律用相对路径 `/api/v1` 调用；开发时 Vite 代理到固定端口（`DEV_API_PORT=47821`，前端 `DEV_WEB_PORT=47822`），生产用随机端口。preload 只暴露令牌与系统能力，不再提供 `apiBase` | 免 CORS 与 `file://` 源问题，CSP 可设为 `'self'` | 2026-10-19 |
| D32 | 后端及其依赖由 electron-vite 整体打包为 `out/main/server.js`；`@aw/*` 为 desktop 的 devDependencies，安装包内没有 node_modules（S7 通过：未签名 dmg 128 MB，打包版与 dmg 挂载版均启动正常） | 打包简单、与 pnpm 布局无关 | 2026-10-19 |
| D33 | MCP 调用归属采用插件方案（S1 通过）：`tool.execute.before` 中**原地修改** `output.args.__aw_session = input.sessionID`（重新赋值对象无效）；放弃 `attempt_token` 备选 | 两个并发会话的 4 次调用全部带上正确 sessionID | 2026-10-19 |
| D34 | 确认 D09：单个 `opencode serve` 并发服务多个 worktree（S4 通过：两目录并发、无串写，会话的 agent / model / system 参数生效）。事件订阅全局流 `GET /global/event`（事件带 `directory`）；权限请求事件为 `permission.asked`，回复用 `permission.reply({ requestID, reply })` | S5 实测 | 2026-10-19 |
| D35 | 每个会话在 `session.create` 时传入 `permission` 规则集（opencode 1.19 支持会话级规则），bash 策略随设置即时生效，**修改 `ai.bashPolicy` 不再需要重启 opencode** | 1.19 SDK 实测能力 | 2026-10-19 |
| D36 | 禁用 opencode 原生 `question` 工具（aw agent 权限 `question: deny`），提问统一走 MCP `ask_user` | 我们的提问存库、可跨应用重启、支持「做出假设并写明」；原生提问的挂起状态在重启后不可恢复（未验证，倾向保守） | 2026-10-19 |
| D37 | 所有 git 调用设置 `LC_ALL=C`；改动 refs 或 worktree 列表的操作经每仓库互斥锁（S6：不加锁时 4 轮中 1 轮出现 3 次 worktree 元数据错误，加锁后 400 次操作零错误；worktree 内部的并发提交无冲突） | 本机 git 输出为中文，解析需固定语言 | 2026-10-19 |
| D38 | 工具返回错误码后模型能按 hint 自我修正（S3 实测：免费模型 glm-5.3-flash-free 收到 `SPIKE_FAIL` 后按 hint 重试成功），验证了「工具失败返回错误码」的设计 | 01 §5 验收标准第 7 条的前置验证 | 2026-10-19 |
| D39 | 不引入 `fastify-type-provider-zod`：操作清单的挂载层（`core/operations`）把 path/query/body 合并后用操作的 zod `input` schema 解析，失败统一抛 `VALIDATION_FAILED`（`details.issues`）；响应体用 `output` schema 解析后返回（剥离 DTO 之外的字段） | 该库 7.0.0 把 `@fastify/swagger` 设为必需 peer 依赖；我们的输入来自三处合并，自己解析十几行即可，错误结构也由我们控制 | 2026-10-19 |
| D40 | M2 的执行 MCP 工具先接**调试尝试**：开发构建的调试入口对一个 Git 目录发起不属于任务的 `execute` 尝试（`attempts.task_id` 为空），由 `debug` 模块提供任务上下文并接收结果（内存中，不建表）；M3 起尝试归属节点 / 任务 | 不必等 tasks / nodes 表即可端到端验证 opencode 托管、MCP、会话流 | 2026-10-19 |
| D41 | `report_progress` 的「当前进展」记在活动尝试上（内存，随 `attempt.updated` 推送，尝试结束清除），节点与规划阶段显示其活动尝试的这一行 | 规划阶段与节点共用一个机制；进展只是瞬时状态，不写库 | 2026-10-19 |
| D42 | `@opencode` 集成测试与开发默认免费模型改为可用的 `opencode/beam-free`（2026-10-19 起 `glm-5.3-flash-free` 免费额度用尽，会话卡在 `session.status: retry`）；测试中经 `AW_OC_TEST_MODEL` 可覆盖 | 免费模型的额度会变，测试不能依赖单一模型 | 2026-10-19 |
| D43 | 表定义文件之间可以直接相互引用（`*.table.ts` → 其他模块的 `*.table.ts`，dependency-cruiser 规则 `tables-import-tables`），其余代码跨模块仍只经 `index.ts` | 外键从下层模块指向上层模块的表（nodes → tasks、attempts → nodes），经 `index.ts` 引用会形成服务层循环；表与表之间是一张图，服务之间仍分层 | 2026-10-20 |
| D44 | 跨服务的事务用环境事务 `core/db/unit-of-work.ts`：`transact(fn)` 嵌套调用加入外层事务，`publish` / `afterCommit` 在提交后才执行 | SQLite 单连接同步事务，服务各自调用 `transact` 即可组合成一个事务；回滚的变更不会推送事件 | 2026-10-20 |
| D45 | 服务分层：inbox / plans / timeline / worktrees → attempts → acceptance → nodes → tasks → scheduler；需要整个任务上下文的入口（`inbox.resolve`、`projects.delete`、节点的通过/驳回/重试）由 tasks 模块实现。尝试通过信号（`attempts.onSignal`：结束、开始等待、等待结束）通知其所有者，不反向依赖 | 状态机之间的联动集中在一个方向，没有循环；新增一种所有者只需订阅信号 | 2026-10-20 |
| D46 | 会话等待用户时（打开的阻塞问题或待处理的权限请求）尝试仍是 `running`，但不计超时；只有等待阻塞问题答案的尝试在运行时消失或后端重启后保留，回答时重新接上原会话 | 用户可能隔很久才回答；权限请求随 opencode 进程失效，会话本身持久化 | 2026-10-20 |
| D47 | 全局并发上限（`scheduler.maxConcurrentAttempts`）计入 `running`/`verifying` 的节点与规划中的任务；等待输入的节点只占每任务上限。调度器只在事件（任务、节点、尝试、设置、运行时变化）后运行，`start(port)` 之后才开始 | 等待用户的会话不消耗算力；API 监听前会话无法回调 MCP | 2026-10-20 |
| D48 | 节点完成时后端以 `agent-workflow <agent-workflow@localhost>` 身份、`--no-verify`、关闭签名提交；并行节点共享任务工作区，先完成的节点的提交会包含此刻工作区中的全部改动 | AI 的提交与用户的提交区分开；用户的钩子与签名可能交互或很慢，验收检查已经是关卡；一个任务一个工作区（D20） | 2026-10-20 |
| D49 | AI 评审会话未能给出结论（未提交、出错、超时、被中止）按检查失败处理（消耗预算，反馈写明评审未完成）；运行时消失则节点回 `ready` 不消耗预算 | 与命令检查一致，节点只有一种失败路径 | 2026-10-20 |
