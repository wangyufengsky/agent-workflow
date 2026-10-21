# 15 · 应用助手（v1.1）

> 状态：**v1.1 已实现**（任务 A-01…A-10，见 [05](05-dev-plan.md#v11--应用助手约-2-周v10-发布后)）。v1.0 交付了它的地基：操作清单（[03 §5](03-architecture.md#5-操作清单operation-registry)）与 ⌘K 命令面板。实现中按保守方案收紧的取舍见 D65（待用户确认）。

## 1. 定位

全局助手：用户用自然语言说想做什么，助手调用应用的各项功能（项目、任务、流程、数据库、Git、以后的知识库与 PPT）完成，或完成简单的通用工作（查日期、生成文档）。

- **入口**：全局侧边面板，任何页面 `⌘J` 打开，知道当前所在页面与选中对象；主页顶部另有助手输入框（与下方结构化「开始任务」并存）。开发任务仍推荐用结构化入口，助手负责零散需求与跨模块操作。
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
| 对话存储 | 表 `assistant_conversations`、`assistant_confirmations`（10 §4，迁移 0008）；消息流 JSONL `<数据目录>/assistant/conversations/<id>.jsonl`（格式同 10 §3，另有 `confirmation`、`attachment` 两种条目）；助手写入 `files/<id>/` 的文件（opencode `write` / `edit` 工具）记为附件条目 |

## 3. 助手 MCP 工具

由操作清单自动生成（`assistant.tools.ts`）：工具名 = 操作 id 中的 `.` 换成 `_`（`tasks.start` → `tasks_start`），说明来自操作定义并附上风险说明，输入 schema 为操作输入去掉凭据字段与 `assistantOmit` 字段后的 **strict** 对象（传了也被拒绝，`VALIDATION_FAILED`）。规则：

- 只生成 `expose.assistant` 的操作；助手面板自己的操作（`assistant.*`）不暴露（助手不能确认自己的调用）。
- 剔除后仍有必填凭据字段的操作不生成工具（`databases.create`、`projects.setHosting`），只能 `open_form`。
- 按界面模式过滤：简单模式下只有 `mode = simple` 的操作，调用时再检查（`MCP_TOOL_NOT_ALLOWED`，hint 提示用户可切到专业模式）。
- `settings.update` 的 `assistant.alwaysAllow`、`opencode.binaryPath` 不进入 schema（D65）。

另有少量助手专用工具（`assistant.helpers.ts`，输入输出 schema 在 `shared/contracts/mcp/assistant-tools.ts`）：

| 工具 | 风险 | 说明 |
| --- | --- | --- |
| `get_current_time` | read | `{ now, date, weekday, timeZone, utcOffset }`：用户所在时区（后端进程的系统时区）的当地时间 |
| `get_app_status` | read | `{ runtime, uiMode, projects, activeTasks, openInbox }` |
| `open_page` | read | `{ page: AssistantPage, params }`（各页面需要的参数为 `ASSISTANT_PAGE_PARAMS`）→ SSE `assistant.navigate`，界面在面板旁跳转 |
| `open_form` | read | `{ form: AssistantForm, values }` → SSE `assistant.open_form`；`values` 按该表单所提交操作的助手输入（不含凭据字段）的 partial 校验，带凭据字段 `VALIDATION_FAILED` |
| `list_files` / `reveal_file` | read | 列出 / 在 Finder 中显示 `files/<id>/` 下的文件（路径相对该目录，越界或不存在 `VALIDATION_FAILED`；显示经 SSE `assistant.reveal_file` 由 preload 完成） |

第一批开放给助手的操作（v1.1）：项目、任务（含开始、取消、结果、再改改、交付）、需要你处理（列表、回答、审批）、流程与角色（读；专业模式可写）、数据库（列表、测试、结构、只读查询：新增操作 `databases.query`，与 AI 的 `db_query` 同样的只读四道关，可用于任意连接）、Git（只读）、设置。知识库、PPT 模块上线时注册其操作即自动可用。

opencode 是否在每次会话中重新读取 MCP 工具列表未经验证；若它缓存启动时的列表，切换界面模式后列表要到 opencode 重启才更新，但调用时的模式检查保证简单模式下不会执行专业操作。

## 4. 风险与确认

| 风险 `OperationRisk` | 例子 | 行为 |
| --- | --- | --- |
| `read` | 列表、详情、查询、跳转 | 直接执行 |
| `write` | 开始任务、添加项目、改设置、回答待处理 | 对话中出现**确认卡片**；用户可在卡片上或设置中把该操作设为「总是允许」 |
| `critical` | 合并 / 建 PR、取消任务、删除项目 / 连接 / 流程 / 角色、清理 worktree、处理「需要你处理」条目（失败条目的「取消」即取消任务，权限的「总是允许」扩大 AI 的权限） | 确认卡片显示影响内容（如合并显示 diff 统计），**不能设为总是允许**（D16：合并永远由人点） |

确认流程（与 `ask_user` 同一模式，不依赖长时间阻塞的工具调用；`assistant.confirmations.ts`，状态机 09 §10）：

1. 工具返回 `{ status: 'needs_confirmation', confirmation_id, instruction }`（instruction 要求模型用一句话说明并结束本轮），后端写 `assistant_confirmations`（`pending`），消息流追加 `confirmation` 条目，推送 `assistant.confirmation`。
2. 界面在对话中渲染确认卡片：操作标题、参数、影响说明（write：可「确认并总是允许」；critical：每次确认），合并（`tasks.deliver`）另显示将合并的改动统计。
3. 用户确认 → 先转为 `confirmed`（再点一次 409，不会执行两次）→ 后端执行操作 → 结果 `{ ok: true, output }` 或 `{ ok: false, error }` 写入 `result` → 用模板 `assistant-confirmed.md` 把结果作为下一条消息发回同一会话；取消 → `cancelled`，发回 `assistant-cancelled.md`（用户取消了该操作）。会话还在回复时消息先排队，本轮结束（空闲）后发出；opencode 不可用时随用户的下一条消息一起发出。
4. `alwaysAllow: true` 只接受 write 级（critical 400 `VALIDATION_FAILED`），同时把操作 id 加入设置 `assistant.alwaysAllow`。之后该操作直接执行；critical 即使被写进列表也照样确认。

设置项 `assistant.alwaysAllow: string[]`（操作 id 列表），设置页「助手」分组可查看与撤销；助手自己不能修改它（D65）。后端代发的确认结果消息不记入消息流（卡片显示结果）。

## 5. 凭据不经过对话

- 涉及凭据的操作（添加数据库连接、绑定远端令牌）在操作定义中标记 `credentialFields`；这些字段**不出现在助手工具 schema 中**，凭据必填的操作没有工具。
- 助手只能调用 `open_form` 打开预填好非敏感字段的表单，由用户在表单中输入凭据并提交。表单（`AssistantForm`，以其提交的操作命名）：`tasks.create`（主页开始任务，经地址预填项目、流程、需求）、`projects.create`（添加项目，预填路径）、`projects.setHosting`（项目详情的远端绑定）、`databases.create` / `databases.update`（数据库连接对话框）；后四者的预填值放在界面状态 `pendingForm` 中，表单提交或关闭时清除。
- 助手工具的返回值同样经过 DTO，不含凭据。

## 6. 界面

- 侧边面板（`features/assistant/`）：`⌘J` 或顶栏的助手按钮开合；作为外壳的第三列（宽 `--drawer-sm`）停靠在右侧，页面在旁边照常可用。对话列表（下拉切换、新建、删除）、消息流（用户消息、Markdown 正文、工具调用与结果折叠为一行、确认卡片、权限卡片、文件附件卡片（Electron 中可「在 Finder 中显示」）、系统事件与错误）、输入框（`⌘↵` 发送；助手回复中显示「停止」）、`Esc` 收起。
- 对话的忙碌状态与权限请求只以 SSE `assistant.updated` 为准（按顺序到达）；发送、停止、回复权限的响应不写缓存，否则可能晚于「本轮已结束」的事件被应用。
- 主页顶部助手输入框：回车后新建对话、打开侧边面板并发送。
- 助手触发的 `open_page` / `open_form` 在面板旁直接导航，面板保持打开；`reveal_file` 经 preload 在 Finder 中显示（浏览器开发模式没有）。

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
| 集成 | `assistant.int.test.ts`：对话增删查与消息流、会话目录 / agent / bash 规则 / 每轮 system、`ASSISTANT_BUSY` 与停止、面板中的权限请求、附件、删除时清理；`assistant.mcp.int.test.ts`：令牌隔离、工具生成与过滤、read / write / 总是允许 / critical / 取消 / 忙时确认、`MCP_CONVERSATION_UNRESOLVED`、`MCP_TOOL_NOT_ALLOWED`、凭据与 D65 字段被拒、全部助手专用工具；`databases.int.test.ts`：`databases.query` |
| `@opencode` | 注入后 `aw-assistant` 与 `agent-workflow-app` 出现在 opencode 配置中，两套 MCP 都已连接 |
| E2E | J11「对助手说开始任务 → 确认卡片 → 任务运行」；主页输入 → 面板、`open_page` 跳转且面板保持打开、「确认并总是允许」→ 设置页撤销；J9 走查含助手面板（简单与专业） |
| live | `live/assistant.live.test.ts`：真实模型查明天的日期并列出项目（调用 `get_current_time` 与 `projects_list`，回复含两者），报告写到 `live/reports/assistant-*.json` |
