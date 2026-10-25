# 15 · 应用助手（v1.1）

> 状态：**v1.1 已实现**（任务 A-01…A-11，见 [05](05-dev-plan.md#v11--应用助手约-2-周v10-发布后)）。v1.0 交付了它的地基：操作清单（[03 §5](03-architecture.md#5-操作清单operation-registry)）与 ⌘K 命令面板。实现中按保守方案收紧的取舍见 D65（①② 用户已确认，③ 待确认）。

2026-10-24 增补：助手可用 `browser_readUrl` 读取明确网址的文字结构与错误日志，沿用网站登录和规则，并强制只读（无法归属标签页的 Worker 被拒绝并记录）；整体读取最长 30 秒，截止显式失败并关闭临时页；可用 `previews_get/start/stop` 管理任务预览，启动/停止继续经过写操作确认。桌面版用户显式打开「我的预览」后，`browser_read` 可读取当前对话关联的用户页；关联等待期间切换预览或对话会取消本次发送并保留草稿。未开放助手页面点击/输入或截图/PDF，见 [29 §9](29-browser.md#9-应用助手)。

## 1. 定位

全局助手：用户用自然语言说想做什么，助手调用应用的各项功能（项目、任务、流程、数据库、Git、以后的知识库与 PPT）完成，或完成简单的通用工作（查日期、生成文档）。

- **入口**（D111、D112，28）：主页以助手为主，唯一的大输入框默认问助手，选一个流程后切到「开始任务」直接建任务（不经过助手）；在主页发出的对话就显示在主页上（`/?conversation=`）。其他页面 `⌘J` 打开浮层面板，知道当前所在页面与选中对象。主页与面板是同一组对话、同一时刻只显示一处：助手带用户离开主页时面板接着显示对话，用户自己离开时只在对话进行中或有待确认卡片时打开，面板开着回到主页时对话移回主页。
- **不是第二套业务逻辑**：助手能做的事 = 操作清单中 `expose.assistant = true` 的操作，与界面、命令面板调用同一个 service。

## 2. 实现方式

| 项 | 设计 |
| --- | --- |
| 模型与运行 | 复用托管的 opencode；agent `aw-assistant`（提示词 `packages/builtin/prompts/protocol-assistant.md`）；每个对话一个 opencode 会话，第一条消息时创建；模型用设置 `ai.defaultModel`（为空时 opencode 默认） |
| 工作目录 | 会话 `directory`、发送、停止、权限回复都指向真实路径 `<数据目录>/assistant/files/<conversationId>/`；生成文档的相对路径从这里计算，每轮上下文写明绝对目录（不能把 `/var` 与 `/private/var` 等别名当不同边界） |
| 原生工具 | agent 权限 `edit: allow`、`external_directory: deny`（原生文件工具仅在本对话目录读写）、`webfetch: ask`、`question: deny`（D36）、`task: deny`（原生子代理不会完整继承权限）；bash 为会话级 `*: ask`，所有 shell 命令都需用户授权（12 §2）；会话的权限询问在面板中以卡片回复（允许一次 / 总是允许 / 拒绝，只在内存中，随 opencode 进程失效） |
| 应用工具 | **助手 MCP**（`/mcp/assistant`，server 名 `agent-workflow-app`），与执行 MCP 分开、令牌分开；bridge 插件对 `agent-workflow_` 与 `agent-workflow-app_` 两种前缀都注入会话 id，调用按会话归属到对话（不属于任何对话 → `MCP_CONVERSATION_UNRESOLVED`）；`aw-assistant` 的权限 deny `agent-workflow_*`，规划 / 执行 / 评审 agent deny `agent-workflow-app_*`，各自只看到自己那套工具 |
| 用户外部 MCP | opencode 合并用户全局配置，用户自己配置的 MCP（如日历）助手可直接使用 |
| 上下文 | 每轮 `system` 注入（模板 `assistant-context.md`）：用户发消息时的当地时间、星期、时区与 UTC 偏移、界面模式、当前页面与选中对象（任务编号与标题、状态、项目；选中的步骤；项目名称与仓库；流程名称）、对话文件目录。页面由前端随消息发送（`AssistantPageRef`），名称由后端查出；新用户消息指向不存在的对象时不发送（如 `TASK_NOT_FOUND`）。系统结果回传使用上一条用户消息的页面，若对象已删除则明确说明不再存在，不阻断结果回传；其他错误仍然抛出 |
| 对话存储 | 表 `assistant_conversations`、`assistant_confirmations`（迁移 0008）与持久化待发队列 `assistant_outbox`（迁移 0018）及 `assistant_task_followups`（迁移 0019，10 §4）；消息流 JSONL `<数据目录>/assistant/conversations/<id>.jsonl`（格式同 10 §3，另有 `confirmation`、`attachment`、`entity_ref`、`chart` 四种条目）；助手写入 `files/<id>/` 的文件（opencode `write` / `edit` 工具）记为附件条目 |

这里是工作目录与工具权限边界，不是操作系统沙箱。opencode 1.19 对 `head` / `rg` 等 shell 命令不完整检查目录，故助手不自动放行所谓只读 shell；用户主动批准 shell 或自己配置的外部 MCP 可具有更广访问能力。应用 `tasks_create` 仍按原有确认流程创建独立任务，不通过原生 `task` 子代理逃逸权限。

### 2.1 旧会话升级与删除

opencode 1.19 的已有会话目录不能通过发送参数或 fork 改变。迁移 0020 为旧记录标记尚未隔离，首次继续对话时同事务摘除旧 session id、保存待清理 id，并把最近 200 条消息流中的可见用户/助手文字（至多 12,000 字符）放入持久化 outbox；不恢复工具输入、工具输出、内部推理或权限授权。界面原始 JSONL 保留，加入目录升级说明。旧会话清理成功后再在独立目录建原生会话，发送成功才确认恢复文字，后续正常轮次不重复注入。清理失败保留待清理 id，重启后继续，不退回旧共享目录。

删除聊天先锁住新消息与系统回传，必要时停止模型，再删除原生会话与待清理旧会话，成功后才释放附件引用、级联清理数据库和移除文件。外部清理失败保留聊天供重试；异步首次建会话/发送尚未返回时拒绝删除，避免迟到的新 session 成为孤儿。

## 3. 助手 MCP 工具

由操作清单自动生成（`assistant.tools.ts`）：工具名 = 操作 id 中的 `.` 换成 `_`（`tasks.start` → `tasks_start`），说明来自操作定义并附上风险说明，输入 schema 为操作输入去掉凭据字段与 `assistantOmit` 字段后的 **strict** 对象（传了也被拒绝，`VALIDATION_FAILED`）。规则：

- 只生成 `expose.assistant` 的操作；助手面板自己的操作（`assistant.*`）不暴露（助手不能确认自己的调用）。
- 剔除后仍有必填凭据字段的操作不生成工具（`databases.create`、`projects.setHosting`），只能 `open_form`。
- 按界面模式过滤：简单模式下只有 `mode = simple` 的操作，调用时再检查（`MCP_TOOL_NOT_ALLOWED`，hint 提示用户可切到专业模式）。
- `settings.update` 的 `assistant.alwaysAllow`、`opencode.binaryPath`、`ai.bashPolicy`、`worktree.rootDir`、`browser.sites`（网站规则，29 §5.4）不进入 schema（D65）。

另有少量助手专用工具（`assistant.helpers.ts`，输入输出 schema 在 `shared/contracts/mcp/assistant-tools.ts`）：

| 工具 | 风险 | 说明 |
| --- | --- | --- |
| `get_current_time` | read | `{ now, date, weekday, timeZone, utcOffset }`：用户所在时区（后端进程的系统时区）的当地时间 |
| `get_app_status` | read | `{ runtime, uiMode, projects, activeTasks, blockingInbox }`（`blockingInbox` 同徽标，不含待合并，D119） |
| `browser_read` | read | 严格空参数；只读当前对话由界面绑定的「我的预览」文字、地址、视口和错误日志；无关联或预览失效为 `BROWSER_NOT_OPEN`，不能用任务或 tab 参数猜测当前页。整体最多 30 秒，超时为 `BROWSER_READ_FAILED`，保留用户页与关联（29 §9） |
| `open_page` | read | `{ page: AssistantPage, params }`（各页面需要的参数为 `ASSISTANT_PAGE_PARAMS`）→ SSE `assistant.navigate`，界面在面板旁跳转；`task_preview` 是任务页的预览页签（`?view=preview`，v1.3 B3，29 §2.6），用户在那里时消息带的当前页面也是它，助手启动预览后用它把用户带过去 |
| `open_form` | read | `{ form: AssistantForm, values }` → SSE `assistant.open_form`；`values` 按该表单所提交操作的助手输入（不含凭据字段）的 partial 校验，带凭据字段 `VALIDATION_FAILED` |
| `show_chart` / `show_flowchart` | read | 在对话里画图（35，D138）：统计图（`bar` / `line` / `pie`，类别 + 系列）或流程图（节点与连线，允许回环）；输入为 strict 对象，跨字段规则与上限见 35 §3，不合规为 `VALIDATION_FAILED`（issues 带 `path` 与改法）；通过后写消息流 `chart` 条目（10 §3）并返回 `{ shown: true }`；界面在消息流中渲染为图（§6.1） |
| `list_files` / `reveal_file` | read | 列出 / 在 Finder 中显示 `files/<id>/` 下的文件（路径相对该目录，越界或不存在 `VALIDATION_FAILED`；显示经 SSE `assistant.reveal_file` 由 preload 完成） |

第一批开放给助手的操作（v1.1）：项目、任务（含开始、取消、结果、再改改、交付）、需要你处理（列表、回答、审批）、流程与角色（读；专业模式可写）、数据库（列表、测试、结构、只读查询：新增操作 `databases.query`，与 AI 的 `db_query` 同样的只读四道关，可用于任意连接）、Git（只读）、设置。知识问答（v1.1，18 §4a）的操作已注册并 `expose.assistant`：`knowledge_ask` / `knowledge_followUp` 为 read（不需确认），工具立即返回 `researching`，回答（带引用链接）与导航卡片在研究结束后作为下一条消息送达；`knowledge_delete` 为 critical，列表、详情、引用原文为 read。PPT 模块上线时注册其操作即自动可用。各模块的覆盖盘点见 28 §4（v1.2 起批量、定时、PPT、审查意见回流都已开放；`open_page` 补了批量、定时与环境检测页）。

需求计划（v1.3，34 §10）：操作全部开放（`initiatives.saveDraft` 除外：改写阶段与工作包在页面上做）；`initiatives_create` 与「开始任务」一样只能转交本对话里的附件（30 §2.2），别的附件直接 `ATTACHMENT_NOT_FOUND`、不出确认卡；`open_page` 可以打开 `initiatives` / `initiative`，用户在需求计划页时 system 写明它的编号、标题、状态、项目、已开启的阶段与完成的工作包数。协议提示词写明：大需求（需求文档、多个功能要分析拆包分阶段）建需求计划而不是一个任务，不带模板时由 AI 拆解；建好后打开需求计划页让用户审阅确认；助手发起的拆解（`initiatives_create` 不带模板、`initiatives_rebreakdown`、`initiatives_refine`、带 `refine` 的 `initiatives_openPhase`）结束后，草稿或失败原因作为下一条消息送回原对话（`prompts/assistant-breakdown.md`，表 `assistant_breakdown_followups`，同成员分析的回报 33 §6）：阶段与工作包、需求覆盖里没有对应工作包的点、确认才开始；用户在页面上又开始了一次的不再回报。

opencode 是否在每次会话中重新读取 MCP 工具列表未经验证；若它缓存启动时的列表，切换界面模式后列表要到 opencode 重启才更新，但调用时的模式检查保证简单模式下不会执行专业操作。

## 4. 风险与确认

| 风险 `OperationRisk` | 例子 | 行为 |
| --- | --- | --- |
| `read` | 列表、详情、查询、跳转 | 直接执行 |
| `write` | 开始任务、添加项目、改设置、回答待处理 | 对话中出现**确认卡片**；用户可在卡片上或设置中把该操作设为「总是允许」 |
| `critical` | 合并 / 建 PR、取消任务、删除项目 / 连接 / 流程 / 角色、清理 worktree、处理「需要你处理」条目（失败条目的「取消」即取消任务，权限的「总是允许」扩大 AI 的权限） | 确认卡片显示影响内容（如合并显示 diff 统计），**不能设为总是允许**（D16：合并永远由人点） |

确认流程（与 `ask_user` 同一模式，不依赖长时间阻塞的工具调用；`assistant.confirmations.ts`，状态机 09 §10）：

1. 工具返回 `{ status: 'needs_confirmation', confirmation_id, instruction }`（instruction 要求模型用一句话说明并结束本轮），后端写 `assistant_confirmations`（`pending`），消息流追加 `confirmation` 条目，推送 `assistant.confirmation`。
2. 界面在对话中渲染确认卡片：操作标题、参数（对象显示名称、字段用中文标签，§6.1）、影响说明（write：可「确认并总是允许」；critical：每次确认），合并（`tasks.deliver`）另显示将合并的改动统计。
3. 用户确认 → 先转为 `confirmed`（再点一次 409，不会执行两次）→ 后端执行操作 → 结果 `{ ok: true, output }` 或 `{ ok: false, error }` 与模板 `assistant-confirmed.md` 生成的待发消息在同一事务保存（无返回值的成功操作用 `output: null`，兼容旧记录缺失 output）→ 回传同一会话；取消 → 在同一事务保存 `cancelled` 与 `assistant-cancelled.md` 消息。会话还在回复或发送请求尚未返回时消息先排队，本轮结束后发出；opencode 不可用或发送失败时保留队列，后端重启后也可随用户的下一条消息发出。只有收到发送成功响应才移除当次消息，不移除期间新入队的消息；恢复只投递结果，不重新执行操作。
4. `alwaysAllow: true` 只接受 write 级（critical 400 `VALIDATION_FAILED`），同时把操作 id 加入设置 `assistant.alwaysAllow`。之后该操作直接执行；critical 即使被写进列表也照样确认。

设置项 `assistant.alwaysAllow: string[]`（操作 id 列表），设置页「助手」分组可查看与撤销（同一分组还列出用户自己在 opencode 里配置的 MCP 服务器与连接状态，附添加方法，28 §4）；助手自己不能修改它（D65）。后端代发的确认结果消息不记入消息流（卡片显示结果）。

### 4.1 普通任务结果回到原对话

助手调用 `tasks.create` 创建的普通任务会持久化关联原对话。确认后执行和总是允许共用同一执行入口，归属与任务插入同事务，启动任务前已登记；取消确认、失败的创建和界面直接创建不会登记。任务的 `TaskUpdated` 只是唤醒信号，权威是 `task_events` 与当前任务数据。

- 到 `review`：汇报已有结果、验证情况和任务入口，明确“开发完成，等待验收”，不能说已接受、合并或交付。
- 到 `failed`：汇报阶段、已记录的失败原因与可用的步骤/命令信息，由用户决定下一步。
- 到 `completed`：按实际交付记录说明完成方式、目标分支、提交或 PR；创建 PR 不能说已合并，报告交付不能说代码合并。跳过检查不算通过，无记录不推断成功。
- 状态快照与事件游标、outbox 同事务保存；重复进度或状态广播不重复入队。启动时补扫未消费任务的最新状态，不逐条重播已经过时的状态。忙碌时排队，断线/失败保留，应用启动、运行时 ready 和下一条用户消息均可恢复投递；删除原对话停止跟进。崩溃时外部是否已收到消息的边界仍可能重复投递，不能宣称跨进程恰好一次。
- 通知模板 `assistant-task-updated.md` 只要求汇报及给出下一步建议，不自动重试、重新建任务、验收、合并或发布。所有后续写操作继续遵循已有确认规则。

## 5. 凭据不经过对话

- 涉及凭据的操作（添加数据库连接、绑定远端令牌）在操作定义中标记 `credentialFields`；这些字段**不出现在助手工具 schema 中**，凭据必填的操作没有工具。
- 助手只能调用 `open_form` 打开预填好非敏感字段的表单，由用户在表单中输入凭据并提交。表单（`AssistantForm`，以其提交的操作命名）：`tasks.create`（主页开始任务，经地址预填项目、流程、需求）、`projects.create`（添加项目，预填路径）、`projects.setHosting`（项目详情的远端绑定）、`databases.create` / `databases.update`（数据库连接对话框）；后四者的预填值放在界面状态 `pendingForm` 中，表单提交或关闭时清除。
- 助手工具的返回值同样经过 DTO，不含凭据。

## 6. 界面

- 助手面板（`features/assistant/`）：`⌘J` 或顶栏的助手按钮开合；**浮在主内容之上**（顶栏下方、右侧，宽 `--drawer-md`，不遮罩），页面宽度不变，未被覆盖的部分照常可用，被覆盖的部分收起面板后操作（D84）。头部：助手标识、对话切换（标题即按钮，弹出对话列表）、新对话、删除、收起；消息流（§6.1）；输入框（随内容增高，`⌘↵` 发送；助手回复中发送键变为「停止」）；`Esc` 收起（对话列表打开时只关列表）。
- 空对话显示欢迎：标识、「有什么可以帮你？」、一句说明与四条建议，点建议即发送。
- 对话的忙碌状态与权限请求只以 SSE `assistant.updated` 为准（按顺序到达）；发送、停止、回复权限的响应不写缓存，否则可能晚于「本轮已结束」的事件被应用。
- 同一对话在首次异步建会话前占住发送入口；空闲事件早于发送响应时，入口仍保持占用，避免用户消息与系统回传交错。建会话或发送失败会释放入口，未送达的系统消息保留。
- **输入框底栏**（36，D143–D144）：主页、侧栏与桌宠的输入框只有输入与底栏两行；底栏左侧「+」菜单（`role="menu"`，方向键移动、`Esc` 关闭并还焦点）收纳「上传文件…」「项目文件…」（只在主页）「附上选中文字…」「附上任务详情 / 附上步骤详情」，右侧「助手用量」按钮（§6.2）、`⌘↵` 与发送 / 停止键。
- **显式文字上下文**：主页的「问助手」、侧栏与桌宠共用「附上选中文字」，只在按下「+」时读取一次当前 DOM 选区（点菜单项时选区可能已经没了），弹窗可编辑或粘贴；不读剪贴板、表单或整个页面。任务／步骤页面另有「附上任务详情／步骤详情」，由后端按任务与步骤 ID 读取允许字段。两者生成现有文本附件后自动打开全文预览，发送前可再次查看或移除；上传未完成或失败时不能发送。主页「开始任务」模式没有助手上下文按钮。
- 上下文快照写明来源、采集时间、任务更新时间，并声明是用户资料而非指令。任务快照包含身份、状态、需求、失败阶段与错误码／消息、结果摘要与步骤摘要；步骤快照包含所属任务、指令、状态、结果摘要、检查是否通过与尝试错误。不会附带原始日志、错误 details、凭据配置或工作区绝对路径。任务改变后仍发送已预览版本；选中文字的页面只作为来源说明，即使对象已经不存在，也不将旧文字视为最新状态。当前页面随消息发送的严格校验保持不变。截图、PDF、视觉输入不在本次范围。
- 导航卡片（A-11，D66）：助手执行的操作若在契约上声明了 `produces`（开始任务、新建批量任务、新建定时任务、添加项目、新建流程 / 角色、新建数据库连接、知识问答），执行成功后消息流出现 `entity_ref` 卡片：图标、对象类型与标题、状态（任务的显示状态随 `task.updated` 实时更新）、「打开」。对象类型 → 页面只在 `web/src/app/entity-routes.ts` 定义；「打开」只跳转页面，面板保持打开；对象已删除时显示「已删除」并禁用按钮。
- 主页（D111，28 §2）：标语、两种模式的输入框、「直接开始」流程、「试试问」建议（点即在新对话中提问，对话显示在主页）、最近对话；对话中为消息流（同一组件）+ 右侧工作概览栏。主页上没有面板，`⌘J` 与顶栏助手按钮聚焦主页输入框。
- 助手触发的 `open_page` / `open_form`、导航卡片「打开」、回答中的应用内链接：跳转并打开面板显示该对话（从主页离开时消息流以视图过渡移入面板，D112）；`open_form` 开始任务回到主页，输入框为「开始任务」模式并预填；`reveal_file` 经 preload 在 Finder 中显示（浏览器开发模式没有）。

### 6.1 视觉规范（D84）

借鉴克制的对话界面风格：大圆角、细边框、宽松留白、次要信息弱化；默认使用自有光球；开发期可在设置切换到带来源说明的临时鲸鱼素材，功能完善后再制作原创小人和动画（32 §1）。

| 项 | 规格 |
| --- | --- |
| 面板材质 | 底 `--frost-sheen` 叠 `--frost`（不透明度 0.8），`backdrop-filter: var(--frost-filter)`（模糊 28px + 饱和度）；顶部 1px `--frost-edge` 高光、1px `--hairline` 外描边、`--frost-shadow`；圆角 `--r-xl`；z-index 35（页面菜单之上、抽屉与对话框之下） |
| 卡片 | `--frost-card` 底、1px `--line-2` 描边、圆角 `--r-md`；头部为 30px 图标块（accent / danger 色调）+ 弱化的类型小字 + 标题 + 状态胶囊；等待确认的卡片外加 3px `--accent-fill`（critical 为 `--danger-fill`）光圈 |
| 用户消息 | 右对齐，`--bubble` 浅底，最大宽 86%，圆角 16px（右下 6px） |
| 助手正文 | 无气泡、全宽 Markdown；知识问答的引用 `[[n]](link)` 显示为数字小胶囊（`aria-label`「引用 n」），点击在应用内打开原文 |
| 动作条 | 一次工具调用一行：20px 状态图标（完成 ✓ / 失败 ! / 中断 ■ / 运行中旋转的光点）、动作（操作的中文标题，`copy/operations.ts`；助手专用工具与 opencode 原生工具的动词在 `TOOL_COPY`；用户自己的 MCP 工具为「使用外部工具」）、处理的对象（文件名、命令等，等宽弱化）。不需确认的写操作（总是允许）可展开为参数摘要；专业模式下所有动作条可展开，显示内部工具名与原始输入输出。等待确认的调用（工具返回 `needs_confirmation`，`needsConfirmationOutputSchema`）不单独成行，由确认卡片代表 |
| 图 | 消息流的 `chart` 条目渲染为卡片：标题、图（柱状纵向 / 横向按标签长度自动选、折线、环形饼图、自上而下的流程图）、口径说明；共用 `components/charts/`，颜色只用主题令牌，每张图附读屏数据表或节点与连线列表；本轮新到达的图从 0 长出，回看时不播放。简单模式下成功的 `show_chart` / `show_flowchart` 调用不单独成行（35 §5，D138–D142） |
| 确认卡片参数 | 「标签 · 值」两列：`refs` 声明的字段显示对象名称（任务为「编号 · 标题」），标签为对象类型；其余字段标签取 `INPUT_FIELD_LABEL`，枚举值取 `INPUT_VALUE_LABEL`，布尔为「是 / 否」，对象值为 JSON；单测保证需确认的操作每个字段都有标签 |
| 思考 | 共用会话流的思考块（25 §4.2）：默认收起为「思考了 N 秒」与第一句预览，正在思考时露出最后几行与打字光标 |
| 跟随 | 消息流贴底跟随，用户上翻后停止跟随，底部浮出「回到最新 · N 条新内容」（25 §4.1） |
| 错误 | danger 底的单行卡片：错误码文案 + 模型服务给出的原因；专业模式另显示错误码与名称 |
| 输入框 | `--frost-card` 底、圆角 `--r-lg`，`field-sizing: content`（最高 200px）；聚焦时 `--accent-line` 描边与 `--ring`；右下圆形发送键 |
| 助手标识 | `--aura` 锥形渐变圆点加高光；空对话 52px、头部 18px、主页助手条 28px |

动效（只用 CSS，不引入动画库）：

| 动效 | 规格 | `prefers-reduced-motion: reduce` |
| --- | --- | --- |
| 抽屉打开 / 关闭 | 从顶栏助手按钮方向滑入、淡入并从 0.94 缩放到 1，`--t-drawer`（0.5s）`--ease-spring`（轻微回弹）；关闭反向 0.24s，动画结束后卸载（`inert` 期间不可操作） | 只淡入淡出（0.14s） |
| 消息出现 | 每条淡入并上移 8px（0.42s）；打开对话时最后 6 条依次错开 50ms，之后到达的立即出现 | 无动画 |
| 工作中 | 面板顶边一道流光、头部标识旋转并呼吸、「正在思考」文字流光（遮罩只改透明度，文字颜色不变）；正在写的正文末尾闪烁的打字光标；运行中的动作条标题流光 | 循环动效全部停止，保留静态状态 |
| 对话列表 | popover（`@starting-style` 淡入缩放），CSS 锚点定位在标题下方 | 只淡入 |

### 6.2 单轮用量与运行时限

主页、侧栏、桌宠在输入框底栏共用「助手用量」按钮（36 §3，D143；对话还没有用量记录时不显示）：悬停提示最近一轮的一句摘要，点开在浮层里显示本轮／最近一轮的状态、实际输入与输出 tokens、耗时，以及会话累计已报告 tokens 和未报告轮次数。统计起点直接显示，起点之前的历史为未知。模型确实报告零时显示 0；没有报告时显示「用量未报告」，即使已经正常结束也不伪造为零。只记录 `StepFinished` 的 input / output，不含缓存与推理 tokens，不记录金额预算或余额。

创建外部会话或发送前先保存 `assistant_turns`，用户消息与应用回传都计为独立轮次；`StepFinished` 保留 message id 与 part id，按所属轮次累计并持久化去重。迟到报告仍归原轮次。助手使用独立的同步原生 HTTP 请求关联每轮完成（接受后即可清空输入，任务尝试仍走原有异步入口）；裸 session Idle / Error 不能结束另一轮。显式 user message id 与 assistant.parentID 绑定用量，原生响应中的错误与请求前置失败会结束该轮；未知传输故障保留忙碌并允许停止。结束结果由状态机记录为完成、用户停止、失败、超时或中断；运行时消失与后端重启各有原因。重启发现未结束轮次只标中断，不自动重发；其耗时未知，避免把离线时段误算成运行时间。

沿用专业设置 `attempt.timeoutMinutes`（默认 60 分钟），设置文案说明同时作用于任务尝试和助手单轮；本轮开始时固定该值。助手等待权限期间暂停，权限全部回复后继续剩余时长；耗时显示仍为含等待的墙钟时间。超时通过注入 Clock 触发停止，不自动重试；外部会话创建迟到时也不再发送已超时的消息，发送返回非成功以保留草稿与附件。

停止先通过本轮 assistant marker 或原生 busy/retry 状态确认 Runner 已启动，再发一次 abort，同时等待该请求的关联结束。整个确认最多 10 秒（Clock），无法确认则明确失败、保持忙碌供重试；已发出的 abort 仍保留屏障，重试等待同一个请求，不重复发 abort。迟到成功按原停止/超时原因收尾。idle、SSE 断流和未知 HTTP 传输错误均不能单独证明停止成功。

## 7. v1.0 需要预留的地基

| 预留 | 位置 |
| --- | --- |
| 操作清单 `defineOperationContract` + `implement()`，REST 与命令面板从清单派生 | 03 §5、M1 |
| 操作定义包含 `risk`、`expose.assistant`、`credentialFields` 字段（v1.0 已填写） | 03 §5 |
| 执行 MCP 路径为 `/mcp/exec`，为 `/mcp/assistant` 留出位置 | 08 §4.1 |
| ⌘J 快捷键保留不占用 | 14 §2 |

## 8. v1.1 开发任务概要（已拆分为 05 的 A-01…A-10）

1. 助手 MCP 服务：从操作清单生成工具、风险拦截与确认流程、凭据字段剔除。
2. `aw-assistant` agent 配置与上下文注入；对话存储。
3. 助手专用工具（§3）。
4. 侧边面板与主页输入框；确认卡片；文件附件。
5. 设置：「总是允许」管理。
6. 测试：每个风险等级的确认路径；凭据字段不可见；E2E「对助手说开始任务 → 确认 → 任务运行」。

## 9. 实现结构与测试

```
server/src/modules/assistant/
├─ assistant.table.ts / .repo.ts   对话、确认、持久化待发队列、任务跟进与轮次表
├─ assistant.usage.ts / .repo.ts   实际报告累计、重放去重、Clock 时限与轮次结束原因
├─ assistant.service.ts           对话、会话、事件 → 消息流、忙碌、权限请求、附件、待发消息
├─ assistant.tasks.ts / .tasks.repo.ts  任务原对话归属、状态回报与启动补扫
├─ assistant.context.ts           每轮 system（当地时间 localTime、页面描述）
├─ assistant.confirmations.ts     确认、取消、执行、结果消息
├─ assistant.tools.ts             由操作清单生成工具；注册表（归属、模式、校验、错误映射）
├─ assistant.helpers.ts           助手专用工具
└─ assistant.operations.ts / .routes.ts / index.ts
```

| 层 | 覆盖 |
| --- | --- |
| 单元 | `localTime` 跨日与各时区偏移；确认状态机；操作清单标注（`assistant.*` 不暴露给助手）；配置快照（两套 MCP、助手 agent、互相 deny） |
| 集成 | `assistant.mcp.int.test.ts` 另覆盖 `entity_ref`（确认后执行与直接执行，失败不写）；`assistant.int.test.ts`：对话增删查与消息流、会话目录 / agent / bash 规则 / 每轮 system、`ASSISTANT_BUSY` 与停止、面板中的权限请求、附件、删除时清理；`assistant.mcp.int.test.ts`：令牌隔离、工具生成与过滤、read / write / 总是允许 / critical / 取消 / 忙时确认、`MCP_CONVERSATION_UNRESOLVED`、`MCP_TOOL_NOT_ALLOWED`、凭据与 D65 字段被拒、全部助手专用工具；`databases.int.test.ts`：`databases.query` |
| 会话生命周期 | `assistant.lifecycle.int.test.ts`：目录隔离、外部删除失败保留、首次发送/删除屏障、删除时排队消息、旧会话升级跨重启；`assistant.lifecycle.oc.test.ts`：真实 opencode 的同目录读写、跨对话读写拒绝、跨目录 shell 需授权、原生子代理不暴露、旧会话迁移与底层删除；本地模型只指定工具调用，不替代原生工具和权限判断 |
| 恢复回归 | `assistant.recovery.int.test.ts`：并发首条消息互斥；void 成功结果与旧记录兼容；断线、发送失败和重启后的结果回传且不重执行业务；建会话失败释放；空闲事件早于发送响应时按序投递；旧页面对象删除后的成功回传 |
| 任务回传 | `assistant.tasks.int.test.ts`：确认/总是允许两条路径在首次任务事件前登记；真实 Git 任务待验收与交付；忙碌、断线、发送失败和重启补扫；事件去重；删除原对话、界面任务、取消确认不跟进；登记失败原子回滚 |
| 文字上下文 | `assistant.snapshots.int.test.ts`：任务变化后保持快照原文、来源与时间，步骤归属、失效对象、选中文字作为不可信资料、长度与严格字段边界；`shell-assistant-context.browser.spec.ts`：主页选区编辑、侧栏任务快照、预览移除、与文件共存、发送后读取、开始任务模式不出现上下文入口，以及生成中移除后迟到的响应不再打开预览或带入消息 |
| 用量回归 | `assistant.usage.int.test.ts`：真实 SQLite 持久化、捕获的真实事件重放去重、迟到用量归属、失败发送、运行时丢失与重启；FakeClock 验证权限等待暂停、剩余时限恢复、超时不重试与建会话迟到 |
| `@opencode` | 注入后 `aw-assistant` 与 `agent-workflow-app` 出现在 opencode 配置中，两套 MCP 都已连接 |
| E2E | J11「对助手说开始任务 → 确认卡片 → 任务卡片状态更新 → 打开任务页」；直接执行出现项目卡片、删除后「已删除」；主页建议 → 对话显示在主页、`open_page` 带用户离开时面板接着显示对话、「确认并总是允许」→ 设置页撤销；J25 主页对话与接力；J9 走查含助手面板（简单与专业）与主页对话 |
| live | `live/assistant.live.test.ts`：真实模型查明天的日期并列出项目（调用 `get_current_time` 与 `projects_list`，回复含两者），报告写到 `live/reports/assistant-*.json` |

## 8. 双形象与桌宠（32）

形象默认 `orb`，设置可即时切换 `whale`；应用内标识与透明桌宠共用形象和动作语义。光球空闲呼吸、工作持续环绕、完成跳跃扩散，鲸鱼播放对应视频；关闭动画或系统减少动态效果时静止。形象不改变助手权限、消息或任务状态。

桌宠复用助手会话、输入框、确认卡片、停止与权限回复；选择通过主进程同步，消息仍以服务器 SSE 为准。桌面上下文为 `desktop`；导航与打开文件由主界面处理。桌宠启用时主界面关闭即隐藏，托盘可恢复或明确退出。独立碎碎念由 `aw-companion` 运行、全部工具 deny，不写工作聊天，结束或取消后删除临时会话。任务通知按真实 `review` / `completed` / `failed` 与阻塞条目生成，多条排队，进度更新不重复提醒。详细阶段与验收状态见 [32](32-companion-assistant.md)。

## 10. 待实施：统一附件与清单

按 [30](30-attachments.md) / [31](31-requirements-checklist.md) 接入。U-02 已实现：发送消息可带 `attachmentIds`，附件内容放进这条消息、消息流记下附件名；`read_attachment` 只能读当前对话的附件；删除对话释放引用。用户消息的附件与现有「助手生成的文件」是不同记录。创建任务时可以带上对话里的附件（U-03）：只接受本对话的附件，确认卡列出文件名。

助手可以帮用户拆验收要求，经确认卡创建带清单的任务或替换清单（write 确认），也可以请求重新核验；逐项人工结论不向助手曝光。交付确认卡列出未满足的必需项。
