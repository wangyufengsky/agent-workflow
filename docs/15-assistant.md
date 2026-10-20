# 15 · 应用助手（v1.1）

> 状态：设计已确认，**v1.1 实现**。v1.0 只交付它的地基：操作清单（[03 §5](03-architecture.md#5-操作清单operation-registry)）与 ⌘K 命令面板。

## 1. 定位

全局助手：用户用自然语言说想做什么，助手调用应用的各项功能（项目、任务、流程、数据库、Git、以后的知识库与 PPT）完成，或完成简单的通用工作（查日期、生成文档）。

- **入口**：全局侧边面板，任何页面 `⌘J` 打开，知道当前所在页面与选中对象；主页顶部另有助手输入框（与下方结构化「开始任务」并存）。开发任务仍推荐用结构化入口，助手负责零散需求与跨模块操作。
- **不是第二套业务逻辑**：助手能做的事 = 操作清单中 `expose.assistant = true` 的操作，与界面、命令面板调用同一个 service。

## 2. 实现方式

| 项 | 设计 |
| --- | --- |
| 模型与运行 | 复用托管的 opencode；新增 agent `aw-assistant`；每个对话一个 opencode 会话 |
| 工作目录 | `<数据目录>/assistant/`，会话 `directory` 指向这里；生成的文档存放在 `assistant/files/<conversationId>/` |
| 原生工具 | edit/write 仅限助手目录（`external_directory: deny`）；bash `ask`；webfetch `ask` |
| 应用工具 | **助手 MCP**（`/mcp/assistant`，server 名 `agent-workflow-app`），与执行 MCP 分开、令牌分开 |
| 用户外部 MCP | opencode 合并用户全局配置，用户自己配置的 MCP（如日历）助手可直接使用 |
| 上下文 | 每轮 `system` 注入：当前日期时间与时区、界面模式、当前页面与选中对象（项目 / 任务 / 节点 id 与名称） |
| 对话存储 | 表 `assistant_conversations`、`assistant_confirmations`；消息流 JSONL `<数据目录>/assistant/conversations/<id>.jsonl`（格式同 10 §3） |

## 3. 助手 MCP 工具

由操作清单自动生成：工具名 = 操作 id 中的 `.` 换成 `_`（`tasks.start` → `tasks_start`），输入 schema、说明、风险等级均来自操作定义。另有少量助手专用工具：

| 工具 | 风险 | 说明 |
| --- | --- | --- |
| `get_current_time` | read | 当前时间、时区、星期 |
| `get_app_status` | read | 运行环境、进行中任务数、待处理数 |
| `open_page` | read | 让界面跳转到指定页面（路由 + 参数） |
| `open_form` | read | 打开指定表单并预填字段（密码、令牌等凭据字段不允许预填） |
| `list_files` / `reveal_file` | read | 列出 / 在 Finder 中显示助手生成的文件 |

第一批开放给助手的操作（v1.1）：项目、任务（含开始、取消、结果、再改改、交付）、需要你处理（列表、回答、审批）、流程与角色（读；专业模式可写）、数据库（列表、测试、结构、只读查询）、Git（只读）。知识库、PPT 模块上线时注册其操作即自动可用。

## 4. 风险与确认

| 风险 `OperationRisk` | 例子 | 行为 |
| --- | --- | --- |
| `read` | 列表、详情、查询、跳转 | 直接执行 |
| `write` | 开始任务、添加项目、改设置、回答待处理 | 对话中出现**确认卡片**；用户可在卡片上或设置中把该操作设为「总是允许」 |
| `critical` | 合并 / 建 PR、取消任务、删除项目 / 连接 / 流程 / 角色、清理 worktree、处理「需要你处理」条目（失败条目的「取消」即取消任务，权限的「总是允许」扩大 AI 的权限） | 确认卡片显示影响内容（如合并显示 diff 统计），**不能设为总是允许**（D16：合并永远由人点） |

确认流程（与 `ask_user` 同一模式，不依赖长时间阻塞的工具调用）：

1. 工具返回 `{ status: 'needs_confirmation', confirmation_id, instruction: 'End your turn; the result will be sent as the next message.' }`，后端写 `assistant_confirmations`（`pending`）。
2. 界面在对话中渲染确认卡片（操作标题、参数的人类可读摘要、影响说明）。
3. 用户确认 → 后端执行操作 → 把结果（或错误码）作为下一条消息发回同一会话；取消 → 发回「用户取消了该操作」。

设置项 `assistant.alwaysAllow: string[]`（操作 id 列表），设置页「助手」分组可查看与撤销。

## 5. 凭据不经过对话

- 涉及凭据的操作（添加数据库连接、绑定远端令牌）在操作定义中标记 `credentialFields`；这些字段**不出现在助手工具 schema 中**。
- 助手只能调用 `open_form` 打开预填好非敏感字段的表单，由用户在表单中输入凭据并提交。
- 助手工具的返回值同样经过 DTO，不含凭据。

## 6. 界面

- 侧边面板：对话列表（可新建 / 切换 / 删除）、消息流（正文、工具调用折叠一行、确认卡片、文件附件卡片）、输入框（`⌘↵` 发送、`Esc` 收起）。
- 主页顶部助手输入框：回车后打开侧边面板并开始新对话。
- 助手触发的 `open_page` / `open_form` 在面板旁直接导航，面板保持打开。

## 7. v1.0 需要预留的地基

| 预留 | 位置 |
| --- | --- |
| 操作清单 `defineOperationContract` + `implement()`，REST 与命令面板从清单派生 | 03 §5、M1 |
| 操作定义包含 `risk`、`expose.assistant`、`credentialFields` 字段（v1.0 已填写） | 03 §5 |
| 执行 MCP 路径为 `/mcp/exec`，为 `/mcp/assistant` 留出位置 | 08 §4.1 |
| ⌘J 快捷键保留不占用 | 14 §2 |

## 8. v1.1 开发任务概要

1. 助手 MCP 服务：从操作清单生成工具、风险拦截与确认流程、凭据字段剔除。
2. `aw-assistant` agent 配置与上下文注入；对话存储。
3. 助手专用工具（§3）。
4. 侧边面板与主页输入框；确认卡片；文件附件。
5. 设置：「总是允许」管理。
6. 测试：每个风险等级的确认路径；凭据字段不可见；E2E「对助手说开始任务 → 确认 → 任务运行」。
