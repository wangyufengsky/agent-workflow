# 15 · 应用助手（v1.1）

> 状态：**v1.1 已实现**（任务 A-01…A-11，见 [05](05-dev-plan.md#v11--应用助手约-2-周v10-发布后)）。v1.0 交付了它的地基：操作清单（[03 §5](03-architecture.md#5-操作清单operation-registry)）与 ⌘K 命令面板。实现中按保守方案收紧的取舍见 D65（①② 用户已确认，③ 待确认）。

## 1. 定位

全局助手：用户用自然语言说想做什么，助手调用应用的各项功能（项目、任务、流程、数据库、Git、以后的知识库与 PPT）完成，或完成简单的通用工作（查日期、生成文档）。

- **入口**（D111、D112，28）：主页以助手为主，唯一的大输入框默认问助手，选一个流程后切到「开始任务」直接建任务（不经过助手）；在主页发出的对话就显示在主页上（`/?conversation=`）。其他页面 `⌘J` 打开浮层面板，知道当前所在页面与选中对象。主页与面板是同一组对话、同一时刻只显示一处：助手带用户离开主页时面板接着显示对话，用户自己离开时只在对话进行中或有待确认卡片时打开，面板开着回到主页时对话移回主页。
- **不是第二套业务逻辑**：助手能做的事 = 操作清单中 `expose.assistant = true` 的操作，与界面、命令面板调用同一个 service。

## 2. 实现方式

| 项 | 设计 |
| --- | --- |
| 模型与运行 | 复用托管的 opencode；agent `aw-assistant`（提示词 `packages/builtin/prompts/protocol-assistant.md`）；每个对话一个 opencode 会话，第一条消息时创建；模型用设置 `ai.defaultModel`（为空时 opencode 默认） |
| 工作目录 | `<数据目录>/assistant/`，会话 `directory` 指向这里；生成的文档存放在 `assistant/files/<conversationId>/`（每轮上下文写明该目录） |
| 原生工具 | agent 权限 `edit: allow`、`external_directory: deny`（只能写助手目录）、`webfetch: ask`、`question: deny`（D36）；bash 为会话级规则 `readonlyBashRules()`（不带检查命令的只读规则，其余 ask，12 §2）；会话的权限询问在面板中以卡片回复（允许一次 / 总是允许 / 拒绝，只在内存中，随 opencode 进程失效） |
| 应用工具 | **助手 MCP**（`/mcp/assistant`，server 名 `agent-workflow-app`），与执行 MCP 分开、令牌分开；bridge 插件对 `agent-workflow_` 与 `agent-workflow-app_` 两种前缀都注入会话 id，调用按会话归属到对话（不属于任何对话 → `MCP_CONVERSATION_UNRESOLVED`）；`aw-assistant` 的权限 deny `agent-workflow_*`，规划 / 执行 / 评审 agent deny `agent-workflow-app_*`，各自只看到自己那套工具 |
| 用户外部 MCP | opencode 合并用户全局配置，用户自己配置的 MCP（如日历）助手可直接使用 |
| 上下文 | 每轮 `system` 注入（模板 `assistant-context.md`）：用户发消息时的当地时间、星期、时区与 UTC 偏移、界面模式、当前页面与选中对象（任务编号与标题、状态、项目；选中的步骤；项目名称与仓库；流程名称）、对话文件目录。页面由前端随消息发送（`AssistantPageRef`），名称由后端查出；指向不存在的对象时消息不发送（如 `TASK_NOT_FOUND`） |
| 对话存储 | 表 `assistant_conversations`、`assistant_confirmations`（10 §4，迁移 0008）；消息流 JSONL `<数据目录>/assistant/conversations/<id>.jsonl`（格式同 10 §3，另有 `confirmation`、`attachment`、`entity_ref` 三种条目）；助手写入 `files/<id>/` 的文件（opencode `write` / `edit` 工具）记为附件条目 |

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
| `open_page` | read | `{ page: AssistantPage, params }`（各页面需要的参数为 `ASSISTANT_PAGE_PARAMS`）→ SSE `assistant.navigate`，界面在面板旁跳转 |
| `open_form` | read | `{ form: AssistantForm, values }` → SSE `assistant.open_form`；`values` 按该表单所提交操作的助手输入（不含凭据字段）的 partial 校验，带凭据字段 `VALIDATION_FAILED` |
| `list_files` / `reveal_file` | read | 列出 / 在 Finder 中显示 `files/<id>/` 下的文件（路径相对该目录，越界或不存在 `VALIDATION_FAILED`；显示经 SSE `assistant.reveal_file` 由 preload 完成） |

第一批开放给助手的操作（v1.1）：项目、任务（含开始、取消、结果、再改改、交付）、需要你处理（列表、回答、审批）、流程与角色（读；专业模式可写）、数据库（列表、测试、结构、只读查询：新增操作 `databases.query`，与 AI 的 `db_query` 同样的只读四道关，可用于任意连接）、Git（只读）、设置。知识问答（v1.1，18 §4a）的操作已注册并 `expose.assistant`：`knowledge_ask` / `knowledge_followUp` 为 read（不需确认），工具立即返回 `researching`，回答（带引用链接）与导航卡片在研究结束后作为下一条消息送达；`knowledge_delete` 为 critical，列表、详情、引用原文为 read。PPT 模块上线时注册其操作即自动可用。各模块的覆盖盘点见 28 §4（v1.2 起批量、定时、PPT、审查意见回流都已开放；`open_page` 补了批量、定时与环境检测页）。

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
3. 用户确认 → 先转为 `confirmed`（再点一次 409，不会执行两次）→ 后端执行操作 → 结果 `{ ok: true, output }` 或 `{ ok: false, error }` 写入 `result` → 用模板 `assistant-confirmed.md` 把结果作为下一条消息发回同一会话；取消 → `cancelled`，发回 `assistant-cancelled.md`（用户取消了该操作）。会话还在回复时消息先排队，本轮结束（空闲）后发出；opencode 不可用时随用户的下一条消息一起发出。
4. `alwaysAllow: true` 只接受 write 级（critical 400 `VALIDATION_FAILED`），同时把操作 id 加入设置 `assistant.alwaysAllow`。之后该操作直接执行；critical 即使被写进列表也照样确认。

设置项 `assistant.alwaysAllow: string[]`（操作 id 列表），设置页「助手」分组可查看与撤销；助手自己不能修改它（D65）。后端代发的确认结果消息不记入消息流（卡片显示结果）。

## 5. 凭据不经过对话

- 涉及凭据的操作（添加数据库连接、绑定远端令牌）在操作定义中标记 `credentialFields`；这些字段**不出现在助手工具 schema 中**，凭据必填的操作没有工具。
- 助手只能调用 `open_form` 打开预填好非敏感字段的表单，由用户在表单中输入凭据并提交。表单（`AssistantForm`，以其提交的操作命名）：`tasks.create`（主页开始任务，经地址预填项目、流程、需求）、`projects.create`（添加项目，预填路径）、`projects.setHosting`（项目详情的远端绑定）、`databases.create` / `databases.update`（数据库连接对话框）；后四者的预填值放在界面状态 `pendingForm` 中，表单提交或关闭时清除。
- 助手工具的返回值同样经过 DTO，不含凭据。

## 6. 界面

- 助手面板（`features/assistant/`）：`⌘J` 或顶栏的助手按钮开合；**浮在主内容之上**（顶栏下方、右侧，宽 `--drawer-md`，不遮罩），页面宽度不变，未被覆盖的部分照常可用，被覆盖的部分收起面板后操作（D84）。头部：助手标识、对话切换（标题即按钮，弹出对话列表）、新对话、删除、收起；消息流（§6.1）；输入框（随内容增高，`⌘↵` 发送；助手回复中发送键变为「停止」）；`Esc` 收起（对话列表打开时只关列表）。
- 空对话显示欢迎：标识、「有什么可以帮你？」、一句说明与四条建议，点建议即发送。
- 对话的忙碌状态与权限请求只以 SSE `assistant.updated` 为准（按顺序到达）；发送、停止、回复权限的响应不写缓存，否则可能晚于「本轮已结束」的事件被应用。
- 导航卡片（A-11，D66）：助手执行的操作若在契约上声明了 `produces`（开始任务、新建批量任务、新建定时任务、添加项目、新建流程 / 角色、新建数据库连接、知识问答），执行成功后消息流出现 `entity_ref` 卡片：图标、对象类型与标题、状态（任务的显示状态随 `task.updated` 实时更新）、「打开」。对象类型 → 页面只在 `web/src/app/entity-routes.ts` 定义；「打开」只跳转页面，面板保持打开；对象已删除时显示「已删除」并禁用按钮。
- 主页（D111，28 §2）：标语、两种模式的输入框、「直接开始」流程、「试试问」建议（点即在新对话中提问，对话显示在主页）、最近对话；对话中为消息流（同一组件）+ 右侧工作概览栏。主页上没有面板，`⌘J` 与顶栏助手按钮聚焦主页输入框。
- 助手触发的 `open_page` / `open_form`、导航卡片「打开」、回答中的应用内链接：跳转并打开面板显示该对话（从主页离开时消息流以视图过渡移入面板，D112）；`open_form` 开始任务回到主页，输入框为「开始任务」模式并预填；`reveal_file` 经 preload 在 Finder 中显示（浏览器开发模式没有）。

### 6.1 视觉规范（D84）

借鉴克制的对话界面风格：大圆角、细边框、宽松留白、次要信息弱化；不使用任何第三方产品的标识或素材。

| 项 | 规格 |
| --- | --- |
| 面板材质 | 底 `--frost-sheen` 叠 `--frost`（不透明度 0.8），`backdrop-filter: var(--frost-filter)`（模糊 28px + 饱和度）；顶部 1px `--frost-edge` 高光、1px `--hairline` 外描边、`--frost-shadow`；圆角 `--r-xl`；z-index 35（页面菜单之上、抽屉与对话框之下） |
| 卡片 | `--frost-card` 底、1px `--line-2` 描边、圆角 `--r-md`；头部为 30px 图标块（accent / danger 色调）+ 弱化的类型小字 + 标题 + 状态胶囊；等待确认的卡片外加 3px `--accent-fill`（critical 为 `--danger-fill`）光圈 |
| 用户消息 | 右对齐，`--bubble` 浅底，最大宽 86%，圆角 16px（右下 6px） |
| 助手正文 | 无气泡、全宽 Markdown；知识问答的引用 `[[n]](link)` 显示为数字小胶囊（`aria-label`「引用 n」），点击在应用内打开原文 |
| 动作条 | 一次工具调用一行：20px 状态图标（完成 ✓ / 失败 ! / 中断 ■ / 运行中旋转的光点）、动作（操作的中文标题，`copy/operations.ts`；助手专用工具与 opencode 原生工具的动词在 `TOOL_COPY`；用户自己的 MCP 工具为「使用外部工具」）、处理的对象（文件名、命令等，等宽弱化）。不需确认的写操作（总是允许）可展开为参数摘要；专业模式下所有动作条可展开，显示内部工具名与原始输入输出。等待确认的调用（工具返回 `needs_confirmation`，`needsConfirmationOutputSchema`）不单独成行，由确认卡片代表 |
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
├─ assistant.table.ts / .repo.ts   两张表
├─ assistant.service.ts           对话、会话、事件 → 消息流、忙碌、权限请求、附件、待发消息
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
| `@opencode` | 注入后 `aw-assistant` 与 `agent-workflow-app` 出现在 opencode 配置中，两套 MCP 都已连接 |
| E2E | J11「对助手说开始任务 → 确认卡片 → 任务卡片状态更新 → 打开任务页」；直接执行出现项目卡片、删除后「已删除」；主页建议 → 对话显示在主页、`open_page` 带用户离开时面板接着显示对话、「确认并总是允许」→ 设置页撤销；J25 主页对话与接力；J9 走查含助手面板（简单与专业）与主页对话 |
| live | `live/assistant.live.test.ts`：真实模型查明天的日期并列出项目（调用 `get_current_time` 与 `projects_list`，回复含两者），报告写到 `live/reports/assistant-*.json` |

## 10. 待实施：统一附件与清单

按 [30](30-attachments.md) / [31](31-requirements-checklist.md) 接入。U-02 已实现：发送消息可带 `attachmentIds`，附件内容放进这条消息、消息流记下附件名；`read_attachment` 只能读当前对话的附件；删除对话释放引用。用户消息的附件与现有「助手生成的文件」是不同记录。创建任务时带上对话里的附件（确认卡列出名称）在 U-03 实现。

助手可以帮用户拆验收要求，经确认卡创建带清单的任务或替换清单（write 确认），也可以请求重新核验；逐项人工结论不向助手曝光。交付确认卡列出未满足的必需项。
