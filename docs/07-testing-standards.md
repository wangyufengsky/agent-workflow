# 07 · 测试规范

## 1. 原则

1. **测试行为，不测实现。** 断言外部可观察的结果（返回值、状态、写入的数据、发出的事件、文件系统与 Git 状态），不断言内部调用次数和私有函数。
2. **少而有效。** 一个行为在最合适的一层测一次。不为凑覆盖率写测试，不在三层重复测同一件事。
3. **真实依赖优先。** SQLite、Git、文件系统用真的（临时目录）；只有 AI（opencode/模型）和第三方 HTTP API（GitHub/GitLab）用假实现。
4. **缺陷先写失败的测试。** 修复缺陷时先写能复现根因的测试（修复前失败），再修代码。
5. **稳定是硬要求。** 不允许 sleep 等待、不允许测试重试；出现不稳定的测试按缺陷处理，找根因。

## 2. 测试分层

| 层 | 工具 | 对象 | 依赖 | 位置 | 命令 |
| --- | --- | --- | --- | --- | --- |
| 单元 | Vitest | 纯逻辑：状态机表、计划校验、调度决策函数、git 输出解析器、配置生成、检查点解析、错误映射、主题对比度 | 无 IO | 被测文件旁 `*.test.ts` | `pnpm test` |
| 集成 | Vitest | 模块 service 与 HTTP/MCP 接口：从 API 或 MCP 调用到数据库与 Git 结果 | 真实 SQLite（临时文件）、真实 git（临时仓库）、Docker 中的真实 MySQL（项目数据库，需本机 Docker；PostgreSQL、openGauss、SQL Server 可选，24 §7）、FakeOpencode、假 Hosting 服务 | `*.int.test.ts` | `pnpm test:int` |
| opencode 集成 | Vitest，标记 `@opencode` | runtime 托管、配置注入、插件、事件解析 | 本机真实 opencode 1.19.0，**不调用模型**（只启动、读配置、建会话、发 `noReply` 消息）；唯一例外是 bridge 插件测试（只有模型能让 opencode 调用工具），用免费模型 `TEST_MODEL`（默认 `opencode-go/deepseek-v4.1-flash`，D62）。需要 opencode 运行工具但不必调用模型的测试（如 `opencode.permissions.oc.test.ts` 检查 bash 规则在真实 opencode 上的判定），用测试内的本地 OpenAI 兼容服务按脚本返回工具调用（opencode 内置 `@ai-sdk/openai-compatible`，经 `OPENCODE_CONFIG` 指向的临时配置注册）。测试文件串行运行（`fileParallelism: false`）：每个文件托管自己的 opencode，共用用户的 opencode 数据库，同时启动时会因「database is locked」退出 | `*.oc.test.ts` | `pnpm test:oc`（先构建插件） |
| E2E | Playwright | 关键用户旅程（§5） | 浏览器模式：后端 + FakeOpencode，后端托管构建出的前端（不经 Vite 开发服务器，17 §4.1）；后端由 global setup（`e2e/global-setup.ts`）启动，监听系统分配的端口并回报，多个 worktree 可同时运行（`AW_DEV_API_PORT` 可指定端口，D78）；Electron 模式：打包产物 | `e2e/` | `pnpm e2e` / `pnpm e2e:electron` |
| live | Vitest，标记 `@live` | 真实模型跑内置流程 | 真实 opencode + 模型 + 示例仓库 | `live/` | `pnpm test:live`（手动，不进 CI） |
| 性能 | Playwright（`playwright.perf.config.ts`） | M6-02 的三项实测：20 节点计划画布的帧率、5 MB 会话流的首屏时间、10 个并发任务时的帧率与长任务；只输出数字到 `perf-results/`（不提交），不作通过/失败门槛 | 生产构建的前端 + 开发模式后端（FakeOpencode） | `e2e/*.perf.spec.ts` | `pnpm perf`（手动） |

## 3. 每一层测什么、不测什么

### 3.1 必须测

- 每张状态机转换表：每个合法转换至少一次、代表性的非法转换。
- `validatePlanGraph` 每个问题子码。
- 调度决策：并发上限、依赖、失败后停止派发、推导任务事件。
- 每个 API 端点：一个成功路径 + 该端点特有的错误码（不重复测通用的 401/400 机制，那由 core 的测试负责一次）。
- 每个 MCP 工具：一个成功路径 + 工具特有的错误码 + 允许的尝试类型限制。
- 每个 opencode 结束条件（12 §4.2）。
- Git 相关：worktree 创建/删除、三种合并策略、冲突、主工作区保护、并发。
- 每个修复过的缺陷：一个回归测试。

### 3.2 不要测

- 框架与库的行为（zod 能否校验、React 能否渲染、Drizzle 能否插入）。
- 仅做转发的薄层（route → service 的透传本身；它们由集成测试经接口覆盖）。
- getter、类型定义、常量值本身。
- 同一逻辑在单元、集成、E2E 各测一遍。
- 整页 DOM 快照、像素对比（截图只用于人工走查，不做断言）。
- 「调用了某 mock 几次」这种实现细节（除非调用本身就是外部可观察的行为，如「向 opencode 发送了答案消息」，此时断言 FakeOpencode 收到的内容）。
- 为不可能的输入写的测试（类型系统已排除的情况）。

### 3.3 快照

只允许用于「输出本身就是产物」的场景：生成的 opencode 配置对象、生成的状态机 Mermaid、提示词模板渲染结果。快照文件须评审。

## 4. 假实现与测试工具

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `FakeOpencode` | `packages/server/test/fakes/fake-opencode.ts` | 实现 `OpencodeClient` 接口；`fake.enqueue(script()…, match?)` 为之后发给会话的消息排一个回合（`match` 按会话标题、agent、目录的子串选会话，第一个匹配的脚本生效）：`edit(file, content)`、`text(…)`、`think(…)`（流式的思考片段）、`callTool(name, args)`、`callAppTool(name, args)`（助手 MCP）、`ask(...)`、`requestPermission(...)`、`hang()`（一直工作直到被中止）、`usage(input, output)`（本回合结束时报告的 tokens，默认 100 / 20）、`error(name, message, { idle? })`（`idle: false` 时报错后不再发空闲事件），回合结束即空闲（没有排脚本的消息直接空闲）；真实写 worktree 文件、真实通过 MCP 调用后端（注入 `__aw_session`）。可断言 `sessions`、`prompts`、`toolCalls`、`aborts`、`permissionReplies`；`crash()` 模拟运行时消失；`failNextPrompt()` 让下一次发消息失败（`OPENCODE_REQUEST_FAILED`）；`settled()` 等待已开始的回合放完。浏览器 E2E 中后端以 `AW_FAKE_OPENCODE=1`（仅开发模式）使用它，spec 经开发接口 `POST /api/v1/dev/fake-opencode/scripts` 排回合（按项目的 worktree 目录匹配，互不干扰）；`createTestApp({ dataDir, fake })` 复用同一个 FakeOpencode 模拟后端重启 |
| `FakeHosting` | `test/fakes/fake-hosting.ts` | 本地 HTTP 服务模拟 GitHub/GitLab 用到的少数端点（读仓库、建 PR/MR、按分支查找打开的 PR/MR、GitHub GraphQL 审查讨论、GitLab 讨论），只认一个令牌；`createTestApp({ hosting: fake.endpoints })` 指向它；断言 `pullRequests`；`failNextPullRequest(status)` 模拟平台报错；`addReviewThread(head, …)` / `addComment(head, …)` 扮演审查者、`closePullRequest(head)` 模拟 PR 已合并或关闭（21）。浏览器 E2E 中后端以 `AW_FAKE_HOSTING_TOKEN` / `AW_FAKE_HOSTING_REPO`（仅开发模式）使用它，spec 经开发接口 `POST /api/v1/dev/fake-hosting/review-threads`、`/comments` 添加意见 |
| `startMysql()` 等 | `test/helpers/db-containers.ts` | 用 Docker 启动一个数据库（随机本地端口、空库 `shop`），等它可以连接（日志中的就绪行；openGauss 的日志写文件，改为等 Docker 健康检查通过的事件）后返回连接参数、`exec(sql)`（管理员身份）与 `stop()`：`startMysql`（MySQL 8.4）、`startPostgres`（17.6）、`startOpenGauss`（7.0.0-RC3，只用 sha256 认证）、`startSqlServer`（2022）；数据库集成测试在 `beforeAll` 中启动一次。镜像需先 `docker pull`（`DB_IMAGE`）：MySQL 必需，其余没有拉取时 `imageAvailable` 打印 `docker pull` 命令、相应用例跳过 |
| `createTestRepo()` | `test/helpers/git.ts` | 在临时目录建 Git 仓库，带初始提交，可选远端（本地 bare 仓库） |
| `createChromiumHost()` | `src/modules/browser/host.chromium.ts` | 浏览器集成测试的宿主：真实 Chromium（playwright-core），`createTestApp({ browserHost })` 注入；页面快照的单元测试输入是从 Chromium 录下的无障碍树 `test/fixtures/browser/orders.ax.json`（对应 `orders.html`），不手编 |
| `e2e/fixtures/browser-host/main.cjs` | — | Electron 中运行真实的 main `browser.ts`（Electron 自带的 Node 直接加载 TypeScript）加本地 HTTP / WebSocket 服务，代替后端发 `browser.request`；`browser-host.electron.spec.ts` 经 `app.evaluate` 驱动，不需要构建应用（29 §14，B-04） |
| `e2e/fixtures/user-preview/main.cjs` | 仅 opencode | 独立临时数据的真实后端、原生 `WebContentsView`、构建后的 preload 和 renderer；`user-preview.electron.spec.ts` 验证用户预览、原生快捷键、助手浮层隐藏/恢复、真实文字读取、离开页签解绑。先 `pnpm build`；不使用用户工作区或现有数据库 |
| `createTestApp()` | `test/helpers/app.ts` | 启动后端（临时数据目录、随机端口），返回类型化 API 调用 `call(op, input)`、`mcpUrl`、FakeOpencode；`realOpencode: true` 用于 `@opencode` 测试；MCP SDK 客户端见 `test/helpers/mcp.ts` |
| `build.*()` | `test/builders/` | 最小测试数据构造器，只填测试关心的字段，其余用合法默认值 |
| `waitForEvent(type, predicate)` | `test/helpers/events.ts` | 订阅 event-bus 等待事件，带超时（默认 20s，慢的 CI runner 与 Windows 上一个任务要几秒）；**替代一切 sleep** |
| git 环境 | `test/setup/git-config.ts`（int 项目的 setupFiles） | 集成测试中的 git 不读开发者的全局与系统配置，且不猜测提交者身份（`user.useConfigOnly`）：结果与全新 CI runner 一致；需要身份的地方必须显式给出（后端用 `BACKEND_COMMITTER`，测试仓库用 `createTestRepo` 的身份） |
| `FakeClock` | `test/helpers/clock.ts` | 注入时钟，测试超时与 nudge 逻辑，不真实等待 |

后端代码中需要时间的地方（超时、时间戳）通过注入的 `clock` 获取，不直接调 `Date.now()` / `setTimeout`，以便测试控制。

## 5. E2E 旅程（只做这些）

| # | 旅程 | 模式 |
| --- | --- | --- |
| J1 | 简单模式：选项目 → 新功能流程 → 输入需求 → 开始 → 结果卡显示改动与检查通过 | 浏览器 |
| J2 | AI 阻塞提问 → 需要你处理中作答 → 节点继续 → 完成 | 浏览器 |
| J3 | 权限请求 → 允许一次 → 继续；下一步的 bash 请求 → 卡片提示将记住的模式 →「总是允许」→ 专业模式项目详情「总是允许的命令」中可见并撤销（D101） | 浏览器 |
| J4 | 检查命令失败 → 自动重试成功；另一节点预算耗尽 → 任务失败 → 用户重试 → 完成 | 浏览器 |
| J5 | 合并到 main（squash）→ 主分支有提交、worktree 已清理、任务已完成 | 浏览器 |
| J6 | 两个任务改同一文件 → 第二个合并冲突 → 交给 AI 解决 → 合并成功；另有三任务版（01 §5 第 3 条）：三个任务同时运行（各自等待一个权限请求）、各自分支与工作区，依次合并，第二、三个冲突交给 AI 解决 | 浏览器 |
| J7 | 专业模式：开启确认计划 → 编辑计划（在连线上加步骤）→ 确认 → 按新计划执行 | 浏览器 |
| J8 | 专业模式：复制内置流程 → 修改 → 用它跑通一个任务 | 浏览器 |
| J9 | 四主题与两种模式切换（含主页的「开始任务」模式与主页对话（28）、新建批量任务、批量视图与其确认对话框、批量任务列表，新建定时任务、定时任务页与删除对话框、定时任务列表、专业模式的修改页，会话流的「正在思考」、上翻后「回到最新」、步骤结束后收起与展开，25），全部页面（含 Git 工作台的提交详情、AI 审查、改动、分支、合并与推送对话框）可打开无报错、无对比度（axe `color-contrast`）与横向溢出问题（1280 宽）；每套主题一个用例（标签 `@walkthrough`，CI 按主题分片），截图写到 `screenshots/walkthrough/<主题>/`（不提交，`AW_WALKTHROUGH_DIR` 可改）供人工走查（`walkthrough.browser.spec.ts`，M6-01） | 浏览器 |
| J10 | 打包应用：引导页 → 添加项目 → J1 精简版（修 Bug，示例仓库 `ts-stats`）；运行中退出重开 → 任务继续完成，被打断的尝试为 `interrupted` 且步骤重跑。真实 opencode 与免费模型 `TEST_MODEL`（生产包里没有 FakeOpencode），每次用全新的用户数据目录；`AW_E2E_EXECUTABLE` 指向打包后的可执行文件（如 dmg 挂载副本） | Electron |
| J11 | 对助手说开始任务 → 确认卡片 → 任务运行（v1.1，`shell-assistant.browser.spec.ts`；同文件另有主页建议 → 对话显示在主页、`open_page` 带用户离开时面板接着显示对话（D112）、「总是允许」→ 设置页撤销、确认卡片参数为名称与中文标签、面板浮层不改变页面宽度、reduced-motion 下开合的冒烟；J9 另截助手的对话、工作中、欢迎与专业模式展开状态，D84） | 浏览器 |
| J12 | 知识问答：提问 → 研究过程（检索、读取）→ 带引用的回答 → 点击引用看原文（高亮、下一处、Esc）→ 续问 → 对话记录中回到对话（v1.1，`project-knowledge.browser.spec.ts`；FakeOpencode 的 `tool` 步骤报告只读的原生工具调用） | 浏览器 |
| J13 | 对助手提问（知识问答）→「正在查资料」→ 导航卡片与带引用的回答 → 点引用看到原文 → 卡片「打开」进入知识对话页（v1.1，`project-knowledge.browser.spec.ts`） | 浏览器 |
| J14 | 知识问答流式回答与模型：草稿出现、引用编号「待核对」不可点 → 提交通过后变为可点击的引用；换模型续问，对话与对话记录显示各轮模型（v1.1，`project-knowledge.browser.spec.ts`） | 浏览器 |
| J15 | Electron 启动冒烟（`launch.electron.spec.ts`，`pnpm e2e:smoke`）：窗口先显示打开动画（点击跳过，D113），构建后的应用启动后端、显示引导页（各项检测有结果）、前端把主题与动画开关写入 `launch.json`、正常退出（main 等后端停止 opencode 后退出）；另用真实 TCP 转发与默认会话预连接复现退出等待环，确认未发送请求的连接也随应用退出释放。不需要 opencode 与模型，三平台 CI 运行（17 §4.1） | Electron |
| J16 | 质量与用量：FakeOpencode 造任务后，简单视图本周三个数、专业视图用量与质量的数字正确；钻取失败原因 → 任务列表 → 任务页；四主题切换无报错（v1.1，`task-insights.browser.spec.ts`） | 浏览器 |
| J17 | 批量任务：主页「补单元测试」的「批量」→ 在目录树中选 3 个目录（按行输入页显示同样的目标）→ 创建 → 三个任务各自跑完到待合并 → 「合并全部待合并的」确认 → 主分支 3 个提交、批次「已全部结束」（v1.1，`task-batch.browser.spec.ts`，20） | 浏览器 |
| J18 | PR 审查意见回流：修 Bug 任务创建 PR → 审查者在 PR 上留下讨论与评论 → 结果卡「取回审查意见」（默认全选）→ 取消一条、填补充说明 →「让 AI 按意见再改改」→ 回到待合并、主按钮为「推送到 PR」→ 推送 → 远端同一分支有 AI 的修改、主分支不变（v1.2，`task-review.browser.spec.ts`，21） | 浏览器 |
| J19 | 定时任务：主页「补单元测试」的「定时」→ 每周一、五 03:30 → 创建 → 「立即运行一次」→ 任务到待合并，「需要你处理」的条目注明来自该定时任务 → 合并 → 暂停后显示「已暂停」（v1.2，`task-schedule.browser.spec.ts`，22；到点运行、补跑、跳过与失败暂停由集成测试用 FakeClock 驱动） | 浏览器 |
| J20 | PPT：项目页「做成 PPT」→ 写要求、加一段文字、指定 3 页 → 生成大纲（AI 的理解）→ 改一页、删一页、加一页 → 确认制作，三页依次出现 → 手改要点、预览同步 → 让 AI 改本页 → 恢复上一版 → 换风格（页面底色即时变化）→ 导出 PowerPoint（下载的 .pptx 有 3 张幻灯片与讲稿）→ 放映翻页与 Esc → 打印视图每页一张（v1.2，`ppt.browser.spec.ts`，23） | 浏览器 |
| J21 | 更多数据库：添加 PostgreSQL 连接（类型切换后端口变为 5432）→ 测试连接显示服务器版本 → 浏览表结构看到表与列注释 → 项目详情关联 → 知识问答勾选数据库，研究员（FakeOpencode）调用 `db_query` 并引用 → 打开引用看到在 PostgreSQL 上重新执行的行（v1.2，`pro-databases.browser.spec.ts`，24 §7；没有 `postgres:17.6` 镜像时跳过） | 浏览器 |
| J22 | 会话流：步骤运行中抽屉「过程」的盒子展开、思考收起为「思考了 N 秒」可展开、等待权限 → 内容在固定高度内滚动并贴底 → 上翻后「回到最新」、点击回到底部 → 允许后步骤结束，过程收起为一行摘要（结果 · 思考 1 段 · N 个动作），展开后连续的读取折叠成组 → 专业步骤页各次尝试纵向排列、已结束的收起、长指令不横向溢出；知识问答研究过程卡里「正在思考」与阶段 → 停止后收起、展开仍有思考（v1.2，`stream.browser.spec.ts`，25） | 浏览器 |
| J23 | 画布（26）：专业模式编辑计划 → 点两步之间连线上的 + 插入步骤（与两侧相连）→ 滚动到图外后继续编辑这一步，视野不被拉回 → 「适应画布」，全部步骤回到画布内 → 用 − 删除后前后自动相连 → 撤销 → 保存为新版本（`pro-plan.browser.spec.ts`） | 浏览器 |
| J24 | Git 工作台：改动视图暂存 →「AI 草拟」提交信息 → 以用户身份提交 → 新建分支并切换 → 再提交 → 分支的「AI 审查」（FakeOpencode 提交一个问题）→ 点问题位置，diff 定位到该行 → 切回 main，压缩合并该分支 → 推送确认列出提交 → bare 远端 main 与本地一致；另一用例：工作台合并冲突 →「交给 AI 解决」开出合并任务 → AI 解决 → 结果卡合并 → main 有两边的改动（v1.2，`pro-git.browser.spec.ts`，27） | 浏览器 |
| J25 | 主页以助手为主（28，D111–D112）：主页上 ⌘J 聚焦输入框 → 让助手开始任务 → 主页消息流中的确认卡片 → 确认 → 导航卡片与工作概览栏出现该任务 → 卡片「打开」→ 任务页，面板显示同一对话 → 回到主页对话移回主页、面板收起（`shell-assistant.browser.spec.ts`）。浏览器 E2E 没有 Electron 的打开动画，不受其影响；动画由 J15 覆盖 | 浏览器 |
| J26 | 页面预览与网站（v1.3，29 §8.5–§8.6，`project-preview.browser.spec.ts`）：项目页填写启动命令与关键页面 → 保存、刷新后仍在 → 试运行显示「已就绪」与日志末尾 → 改成会退出的命令再试运行，显示错误与日志末尾；设置「网站」添加规则、改为可操作、上移 → 保存 → 刷新后顺序与权限不变；浏览器版提示登录窗口只在桌面版、没有已登录的网站。E2E 的后端把 `HOME` 换成临时目录，全局启动因此显式设置 `PLAYWRIGHT_BROWSERS_PATH`，开发用的浏览器宿主才找得到浏览器 | 浏览器 |
| J27 | 放置的标签页与浮层（v1.3，29 §8.1，`overlays.electron.spec.ts`）：构建后的应用（全新用户目录，经 API 加一个项目）→ 设置「网站登录」打开本地网站，窗口多一个视图 → ⌘K 打开时视图离开窗口，Esc 关闭后回来 →「完成」后视图移除、应用正常退出。不需要 opencode 与模型 | Electron |
| J28 | 任务页预览（v1.3，29 §8.1–§8.2，`task-preview.browser.spec.ts`）：AI 的会话打开预览的页面 → 任务页「预览」页签：浏览器版提示在桌面版显示、底栏「运行中」→ 选「AI：定位根因」看到动作列表与画面（图片确实解码）→ 停止预览后显示「预览已停止」→ 改成会退出的启动命令后「重新启动」→ 启动失败画面（日志末尾、「修改预览设置」）→ 回到「进度」。走查另加 `task-preview`（简单）与 `pro-task-preview-frames`（专业，AI 画面） | 浏览器 |
| J29 | 页面体检（v1.3，29 §7、§8.3–§8.4，`task-page-check.browser.spec.ts`）：修 Bug 的「修复」第一次提交后页面报错 → 体检不通过 → 下一次尝试改好并打开页面 → 通过 → 结果卡「页面」区的截图与「打开预览」→ 步骤「产出」里每页每视口一行、缩略图放大 →「过程」里展开「打开」动作看到画面（图片都确实解码）；另一用例：预览从没启动过 → 失败面板说明页面体检没法运行、「重新检查」「修改页面预览设置」、预览日志末尾 →「跳过这项检查」→ 结果卡写明「页面体检（已跳过）」。「附上当前页面」要桌面版的标签页，由后端集成测试覆盖 | 浏览器 |
| J30 | 任务页预览（v1.3，29 §8.1，`preview.electron.spec.ts`）：构建后的应用（全新用户目录，经 API 加项目、配置预览、建一个停在确认计划的修 Bug 任务）→ 预览页签「启动预览」→ 窗口多一个视图且是预览的真实页面 → 地址栏换到报错的页面，底栏「控制台错误 1」→ 切到「进度」视图离开窗口、切回来回到窗口 → 重新加载页面时标签页关闭（视图与 webContents 都回到之前的数目）→ 标签页开着时应用正常退出。不需要 opencode 与模型 | Electron |
| J31 | 知识问答的网页摘录（v1.3，29 §2.8，`project-knowledge.browser.spec.ts`）：打开网络开关提问 → 研究员用 `browser_open` 读本地网页并引用它 → 打开引用，「引用原文」面板显示「在浏览器中打开」与读到的正文摘录 | 浏览器 |
| J32 | PPT 网页资料（v1.3，29 §2.8，`ppt.browser.spec.ts`）：从项目「做成 PPT」→ 资料「网页」输入本地网页地址、回车添加，列表显示地址与「网页」→ 生成大纲 → 大纲出现，PPT 的资料是 `web`、`ref_id` 为地址、标题为网页标题 | 浏览器 |
| J33 | 附件（30，U-03，`task-attachments.browser.spec.ts`）：开始任务时选文件 → 图片给出提示、不是文本的卡片报错且「开始」不可用 → 移除后开始 → 任务页标题下的附件打开看到原文；问助手时附上文件 → 消息下面的附件可打开 | 浏览器 |
| J34 | 验收清单（31，Q-03，`task-requirements.browser.spec.ts`）：开始任务时填两项（AI 核验、命令 `false`）→ 核验步骤后结果卡显示两项未满足 → 交付提醒挡住合并、勾选确认后可用 → 人工「通过」一项、「接受未完成」一项（原因必填）→ 全部满足、提醒消失 → 合并完成 | 浏览器 |

E2E 使用页面上的可访问名称与 `data-testid`（仅在无合适可访问名称时）定位，不用 CSS 类名。

审查过程回归（`review-progress.browser.spec.ts`，J24 / J22）：四类 Git 审查入口均能查看进展、思考、正文与工具输入输出，刷新后保留，完成后收起；重新审查选中新过程、历史互不串流，停止后仍可展开。任务 AI 评审在当前步骤与简单过程页可见。真实 opencode 权限回归用本地脚本模型并行触发两条 `find`，验证「总是允许」发出两条完成事件及重复答复的明确失效错误；集成覆盖 SSE / HTTP 竞争、重复投递、无关条目保留和助手同步。

## 6. live 测试

- 托管平台 `live/hosting.live.test.ts`（M4-05）：无效令牌在 github.com 与 gitlab.com 上为 `HOSTING_AUTH_FAILED`；设置 `AW_LIVE_HOSTING_PROVIDER` / `AW_LIVE_HOSTING_REPO` / `AW_LIVE_HOSTING_TOKEN`（自建 GitLab 另加 `AW_LIVE_HOSTING_BASE_URL`）时验证真实令牌，再设 `AW_LIVE_HOSTING_PR_HEAD` / `AW_LIVE_HOSTING_PR_BASE` 时创建一个 PR。
- 示例仓库：`live/fixtures/` 下的小项目，各带一个已知缺陷和一个功能需求：`ts-stats`（TypeScript + `node --test`，M3-12）；`java-inventory`（Java 17 + Maven + JUnit 5，M6-05）。说明见 `live/fixtures/README.md`。
- M3-12 冒烟 `live/smoke.live.test.ts`：`bugfix` 与 `feature` 各跑一次，报告写到 `live/reports/smoke-<时间>.json`（尝试、提醒次数、用量、`submit_*` 调用成败）。
- 用例（M6-05 `live/workflows.live.test.ts`，与冒烟合起来）：内置流程各一次（Java 项目上的修 Bug、代码审查、重构、方案设计、详细设计，TypeScript 项目上的新功能、补单测、修 Bug、版本比对审查、清理告警、需求拆解，`todo-web` 上的安全审查；版本比对审查与清理告警用 `runTask` 的 `history` 选项预置带日期的提交）；统计 `submit_*` 调用成功率、尝试次数、耗时、成本，输出报告到 `live/reports/`。另有 `mcp-errors.live.test.ts`（工具错误码让模型改正计划，01 §5 第 7 条）与 `permissions.live.test.ts`（只读会话的 bash 规则在真实 opencode 上的效果，D63）。辅助代码在 `live/live-app.ts`；各套件依次运行（`fileParallelism: false`）。
- 浏览器 `live/browser.live.test.ts`（v1.3 B1 的完成标准，29 §13）：示例仓库 `todo-web`（零依赖的 Node 静态服务器），新功能流程给页面加「清空」按钮并在页面预览里验证；默认免费模型（能看图）与一个没有图片输入的模型（`AW_LIVE_TEXT_MODEL`，默认 `opencode-go/glm-5.3`）各跑一次，断言任务到待合并、会话里有成功的 `browser_open` 与 `browser_click`。浏览器用开发宿主（playwright-core 的 Chromium）。
- 浏览器读取 `live/browser-reading.live.test.ts`（v1.3 B3 的完成标准，29 §13）：默认免费模型。知识问答打开网络开关，研究员用浏览器读一个要执行脚本才显示正文的本地网页并引用它，断言回答通过且 `web` 引用的摘录含页面正文；助手在任务页启动预览（确认卡片）并打开预览页签，测试扮演界面打开用户的预览并关联、把预览导航到报错的 `/broken`（`/` 保持干净，任务的页面体检才能通过），再问「这个页面为什么报错」，断言调用了 `browser_read` 且回复含控制台错误。报告写到 `live/reports/assistant-browser-reading-<时间>/`。
- 应用助手 `live/assistant.live.test.ts`（A-09）：让助手查明天的日期并列出项目，断言调用了 `get_current_time` 与 `projects_list`、回复含明天的日期与项目名，报告写到 `live/reports/assistant-<时间>.json`。
- 不作为通过/失败的硬门槛（模型有随机性），但内置提示词改动的 PR 必须附 live 报告对比。

## 7. 编写规则

- 测试名描述行为：`it('拒绝包含环的计划并返回 CYCLE')`，中文英文均可，同一文件保持一致。
- 结构 Arrange / Act / Assert，一个测试验证一个行为；可以有多个相关断言。
- 测试之间不共享可变状态；每个集成测试用独立临时目录与数据库。
- 临时目录照常用 `mkdtemp(join(tmpdir(), 'aw-…'))` 创建，不在测试里各自删除：Vitest 各层的 setup（`packages/server/test/setup/temp-dir.ts`）把每个测试文件的 `os.tmpdir()`（TMPDIR，Windows 上 TEMP / TMP）指向属于该文件的一个目录，文件自己的 `afterAll` 关掉后端与进程之后整个删除；这些目录都在本次运行的一个目录里（全局 setup `temp-root.ts`），运行结束时删除，加载失败、没有运行钩子的文件留下的目录随之删除；E2E 的全局启动（`e2e/global-setup.ts`）同样把整次运行的临时目录（后端的 HOME、spec 的仓库与 Electron 配置目录、它们启动的进程的）放进一个目录，后端退出后删除；`pnpm perf` 的目录（同时是它的临时目录）在运行器退出时删除。失败的运行同样删除，排查靠 trace（§1）与日志。
- 断言具体值，不用「不为空」「被调用过」这类弱断言代替。
- 错误断言断言错误码：`await expect(p).rejects.toMatchObject({ code: ErrorCode.PlanInvalid })`。
- 测试代码同样遵守 06 规范（除允许 `as` 构造数据）。

## 8. 覆盖率与门槛

- 不设全局覆盖率百分比。
- 以下模块要求分支覆盖率 ≥ 90%：`shared/fsm`、`shared/workflow`（计划校验）、`scheduler`、`mcp.registry`。
- 本地 `pnpm verify`：check + test + test:int + build，另加 e2e（浏览器）必须全绿；`test:oc` 在装有 opencode 的机器上随 `pnpm verify:full` 执行。
- 当前的验收以本机 macOS 的全量验证为准：`pnpm verify`、`pnpm e2e`、`pnpm test:oc`、`pnpm e2e:electron`（D82，用户确认）。跨平台代码照常按 `core/platform.ts` 写，平台相关的单元测试在 macOS 上也会运行；Windows / Linux 的真机与 CI 验证推迟到正式版本之前。
- GitHub Actions（`.github/workflows/ci.yml`，v1.1）：只在手动触发时运行（`workflow_dispatch`：发布前或需要时，17 §4.1），PR、推送到 main 与 tag 都不触发。一次运行在 macOS / Ubuntu / Windows 三平台跑 verify 各步骤、浏览器 E2E、Electron 启动冒烟（J15，Linux 用 xvfb），Ubuntu 与 Windows 另打安装包。Ubuntu 与 Windows 上这些步骤拆成并行的 job，集成测试与浏览器 E2E 分片运行，J9 每套主题一片；macOS 一个 job（D81，耗时与计费分钟见 17 §4.3）。失败的 job 用 GitHub 的「Re-run failed jobs」单独重跑。数据库集成测试（`databases.int.test.ts`、`databases.engines.int.test.ts`）只在 Ubuntu 上运行（Windows runner 不能运行 Linux 容器、macOS runner 没有 Docker），由工作流显式排除；`test:oc`、`test:live`、J10 不进 CI（17 §4）。
- 测试失败时禁止 `.skip` 合并；确需暂时跳过须附任务编号与原因，并在一周内处理。

## 9. 待实施设计的验证计划（30 / 31）

以下是 U / Q 的验收计划，不是现有通过结果。

| 层级 | 必要新增行为 |
| --- | --- |
| 单元 | 清单显示状态纯函数（版本与提交变化、取最新结论、用户结论过期、waived 不算通过） |
| 集成 | 真实文件与 SQLite：附件超限／非 UTF-8／含 NUL 被拒且不留记录、项目文件越界、共享引用、按年龄清理、跨任务／对话读不到；真实 Git：核验节点在两类流程都出现、命令逐条运行（前一条失败、后一条照常通过）且不重试、再改改后旧结论 stale |
| 浏览器 E2E | 选择／拖放附件、失败卡片与粘贴图片的提示；建清单 → 命令项失败 → 针对该项再改改 → 重新核验通过；人工确认；带未满足项交付的提醒 |
| opencode / live | 提示词里的资料清单与摘录；真实模型用 `read_attachment` 读完长附件；真实模型逐项给出清单结论 |

不得把 FakeOpencode、页面健康检查或截图数量当作真实业务验收通过。
