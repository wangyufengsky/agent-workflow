# 08 · 枚举、常量与错误码

所有定义位于 `packages/shared/src`。本文是其权威说明；代码与本文不一致视为缺陷。

## 1. 写法约定

```ts
// enums/task-status.ts
export const TaskStatus = {
  Draft: 'draft',
  Preparing: 'preparing',
  // ...
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus);
export const taskStatusSchema = z.enum(TASK_STATUSES);
```

- 值一律 `snake_case` 字符串，存库、传输、日志都用这个值；不用 TS `enum`，不用数字。
- 代码中引用 `TaskStatus.Running`，不写字面量 `'running'`（测试断言除外）。
- 显示文案不在枚举里，在 `web/src/copy/`；颜色语气（tone）在 `shared/enums/status-tone.ts` 的映射表里。

## 2. 枚举

### 2.1 界面

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `UiMode` | `simple` · `pro` | 全局界面模式，默认 `simple` |
| `ThemeId` | `deepseek` · `warm` · `spdb` · `github_white` | 四套主题 |
| `ThemePreference` | `ThemeId` 的全部值 · `system` | 设置值；`system` 时暗色用 `deepseek`、亮色用 `github_white`（常量 `SYSTEM_THEME_MAP`） |
| `StatusTone` | `idle` · `run` · `wait` · `warn` · `ok` · `done` · `danger` | 状态色语气，对应主题 token `--{tone}` / `--{tone}-fill` / `--{tone}-line` |

### 2.2 任务与执行

| 枚举 | 值 |
| --- | --- |
| `TaskStatus` | `draft` · `preparing` · `planning` · `plan_review` · `running` · `paused` · `review` · `merging` · `completed` · `failed` · `cancelled` |
| `TaskFailedPhase` | `preparing` · `planning` · `running` · `merging` |
| `NodeStatus` | `pending` · `ready` · `running` · `waiting_input` · `verifying` · `awaiting_acceptance` · `done` · `failed` · `skipped` · `cancelled` |
| `AttemptKind` | `plan`（规划会话）· `execute`（节点执行会话）· `review`（AI 评审验收会话） |
| `AttemptStatus` | `starting` · `running` · `succeeded` · `failed` · `aborted` · `interrupted` |
| `PlanStatus` | `draft` · `confirmed` · `superseded` |
| `PlanSource` | `ai` · `template` · `user` |
| `CheckpointKey` | `confirm_plan`（运行前确认计划）· `accept_each_node`（每个节点人工验收）· `ask_on_uncertainty`（不确定时停下来问） |
| `AcceptanceCheckKind` | `command`（在 worktree 运行命令，退出码 0 为通过）· `ai_review`（评审角色会话） |
| `TaskEventEntity` | `task` · `node` · `attempt` · `plan` · `delivery`（`task_events.entity`） |

各状态含义与转换见 [09-state-machines.md](09-state-machines.md)。

**任务显示状态（简单模式）**`TaskDisplayGroup` 由 `TaskStatus` + 是否有打开的「需要你处理」条目推导：常量 `TASK_DISPLAY_GROUP`（状态 → 显示）与函数 `resolveTaskDisplayGroup(status, hasOpenAttentionItem)`，覆盖规则的条目类型为常量 `ATTENTION_INBOX_KINDS`：

| `TaskDisplayGroup` | 显示 | 来源 |
| --- | --- | --- |
| `preparing` | 准备中 | `draft` `preparing` `planning` |
| `plan_review` | 待确认计划 | `plan_review` |
| `running` | 执行中 | `running` |
| `paused` | 已暂停 | `paused` |
| `needs_attention` | 需要你处理 | 任意非终态 + 存在 `open` 的 `question` / `permission` / `acceptance` 条目（覆盖上面几种显示） |
| `review` | 待合并 | `review` |
| `merging` | 合并中 | `merging` |
| `completed` | 已完成 | `completed` |
| `failed` | 失败 | `failed` |
| `cancelled` | 已取消 | `cancelled` |

### 2.3 流程与角色

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `WorkflowKind` | `builtin` · `custom` | 内置流程只读，可复制为自定义 |
| `WorkflowPlanning` | `fixed` · `ai` | 固定 DAG / AI 在约束内规划 |
| `WorkflowDeliverable` | `code_changes` · `report` | 代码审查等只读流程产出报告，不合并 |
| `RoleBaseAgent` | `planner` · `executor` · `reviewer` | 对应注入 opencode 的 agent `aw-planner` / `aw-executor` / `aw-reviewer`，决定权限基线 |
| `RoleKind` | `builtin` · `custom` | |
| `NodeKind` | `normal` · `revise` | `revise` 为「再改改」/「解决冲突」追加的节点 |
| `RequiredStepPosition` | `first` · `last` | 流程必经步骤在 AI 计划中的位置约束（5.3 `REQUIRED_STEP_ORDER`） |

### 2.4 Git 与交付

| 枚举 | 值 |
| --- | --- |
| `WorktreeStatus` | `creating` · `ready` · `removing` · `removed` · `error` |
| `DeliveryStrategy` | `squash` · `merge` · `rebase` · `pull_request` · `report_only` |
| `DeliveryStatus` | `running` · `succeeded` · `conflict` · `failed` |
| `HostingProvider` | `github` · `gitlab` |
| `ChangeRequestReason` | `user`（让 AI 再改改）· `conflict`（交给 AI 解决冲突）；`request-changes` 的 `reason` |

`LOCAL_MERGE_STRATEGIES`（`squash` / `merge` / `rebase`，即 `delivery.defaultStrategy` 的取值）与 `isLocalMerge` 在同一文件。

### 2.5 需要你处理（Inbox）

| 枚举 | 值 |
| --- | --- |
| `InboxKind` | `question` · `permission` · `acceptance` · `plan` · `failure` · `delivery` |
| `InboxStatus` | `open` · `resolved` · `dismissed` |
| `PermissionDecision` | `once` · `always` · `reject`（与 opencode 取值一致） |

### 2.6 系统与其他

| 枚举 | 值 |
| --- | --- |
| `RuntimeStatus` | `not_installed` · `version_mismatch` · `stopped` · `starting` · `ready` · `crashed` |
| `Platform` | `darwin` · `win32` · `linux`（运行应用的操作系统，17 §1） |
| `DbType` | `mysql` |
| `CredentialKind` | `git_token` · `db_password` |
| `TranscriptEntryKind` | `user_message` · `text` · `reasoning` · `tool_call` · `tool_result` · `file_edit` · `permission` · `system` · `error` · `confirmation` · `attachment` · `entity_ref`（后三种仅助手对话，10 §3） |
| `TranscriptSystemEvent` | `attempt_started` · `nudged` · `retrying` · `result_submitted` · `awaiting_input`（等待用户回答或授权）· `timed_out` · `aborted` · `runtime_lost`（`system` 会话流条目记录的事件，文案在前端） |
| `McpToolName` | 执行 MCP 工具名（12 §6）；`ATTEMPT_SUBMIT_TOOL` 为每种尝试的提交工具 |
| `BashPolicy` | `auto`（默认放行，禁止 Git 写操作）· `ask`（只读命令放行，其余询问） |
| `OperationRisk` | `read` · `write` · `critical`（操作清单风险等级，决定助手确认行为，见 15 §4） |
| `ServerEventType` | 见 [11-api.md §11](11-api.md#11-sse-事件) |

### 2.7 应用助手（v1.1，`enums/assistant.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `AssistantConfirmationStatus` | `pending` · `confirmed` · `cancelled` | 确认卡片（09 §10） |
| `AssistantToolName` | `get_current_time` · `get_app_status` · `open_page` · `open_form` · `list_files` · `reveal_file` | 助手专用工具（15 §3）；其余工具由操作清单生成 |
| `AssistantPage` | `home` · `tasks` · `task` · `node` · `inbox` · `projects` · `project` · `settings` · `git` · `git_project` · `workflows` · `workflow` · `roles` · `databases` · `tools` · `runtime` | 当前页面与 `open_page` 的目标；每个页面需要的参数为常量 `ASSISTANT_PAGE_PARAMS`（`taskId` / `nodeId` / `projectId` / `workflowKey`） |
| `EntityKind` | `task` · `project` · `workflow` · `role` · `db_connection` · `knowledge_conversation`（预留） | 操作契约 `produces` 的对象类型（`enums/entity.ts`）；`entity_ref` 条目的 `kind`；`workflow` 的 id 为流程 key（D66） |
| `AssistantForm` | `tasks.create` · `projects.create` · `projects.setHosting` · `databases.create` · `databases.update` | `open_form` 能打开的表单，以其提交的操作命名（`ASSISTANT_FORM_OPERATION`）；预填值的 schema 为该操作的助手输入（不含凭据字段）的 partial |

## 3. 状态 → 语气映射（`STATUS_TONE`）

`STATUS_TONE.task` / `.node` / `.attempt` / `.runtime` / `.taskDisplay`（类型保证每个值都有映射，单测再校验一次）。`runtime`：`ready` → `ok`，`starting` → `run`，`stopped` → `wait`，`not_installed` / `version_mismatch` / `crashed` → `danger`。

| tone | TaskStatus | NodeStatus | AttemptStatus | TaskDisplayGroup |
| --- | --- | --- | --- | --- |
| `idle` | `draft` | `pending` · `skipped` · `cancelled` | — | — |
| `run` | `preparing` · `planning` · `running` · `merging` | `ready` · `running` · `verifying` | `starting` · `running` | `preparing` · `running` · `merging` |
| `wait` | `plan_review` · `paused` | `waiting_input` · `awaiting_acceptance` | — | `plan_review` · `paused` · `needs_attention` |
| `ok` | `review` | `done` | `succeeded` | `review` |
| `done` | `completed` | — | — | `completed` |
| `danger` | `failed` | `failed` | `failed` | `failed` |
| `warn` | `cancelled` | — | `aborted` · `interrupted` | `cancelled` |

## 4. 常量

### 4.1 固定常量（`constants/app.ts`）

| 名称 | 值 | 说明 |
| --- | --- | --- |
| `APP_ID` | `agent-workflow` | 数据目录名、MCP server 名 |
| `OPENCODE_VERSION` | `1.19.0` | 精确匹配，不匹配则 `version_mismatch` |
| `OPENCODE_AGENT_NAME` | `{ planner: 'aw-planner', executor: 'aw-executor', reviewer: 'aw-reviewer' }` | |
| `MCP_SERVER_NAME` | `agent-workflow` | 执行 MCP；opencode 中工具名为 `agent-workflow_<tool>` |
| `MCP_ASSISTANT_SERVER_NAME` | `agent-workflow-app` | 助手 MCP（v1.1）；opencode 中工具名为 `agent-workflow-app_<tool>` |
| `OPENCODE_ASSISTANT_AGENT` | `aw-assistant` | 助手的 agent（v1.1） |
| `TASK_KEY_PREFIX` | `T-` | 任务编号 `T-<自增>` |
| `BRANCH_PREFIX` | `aw/` | 分支名 `aw/<taskKey>-<slug>` |
| `BRANCH_SLUG_MAX` | `40` | slug 由标题转写，只保留 `[a-z0-9-]`（`toSlug`，`shared/naming.ts`） |
| `PROJECT_SLUG_MAX` | `40` | 项目 slug（worktree 目录名）由名称转写；无 ASCII 字符时为 `project`，重名追加 `-2`、`-3` |
| `API_PREFIX` | `/api/v1` | |
| `DEV_API_PORT` / `DEV_WEB_PORT` | `47821` / `47822` | 仅开发；生产后端随机端口（D31） |
| `MCP_EXEC_PATH` | `/mcp/exec` | |
| `MCP_ASSISTANT_PATH` | `/mcp/assistant` | v1.1 |
| `ASSISTANT_DIR` / `ASSISTANT_FILES_DIR` / `ASSISTANT_CONVERSATIONS_DIR` | `assistant` / `files` / `conversations` | 助手工作目录 `<数据目录>/assistant/`，对话文件 `files/<id>/`，消息流 `conversations/<id>.jsonl` |
| `PROJECT_CHECK_PLACEHOLDER` | `$PROJECT_CHECK` | 验收命令中代表项目检查命令，物化节点时替换（13 §1） |
| `GIT_COMMIT_IDENTITY` | `agent-workflow <agent-workflow@localhost>` | 节点完成时后端提交的作者与提交者（09 §3） |

`constants/opencode.ts`：

| 名称 | 值 | 说明 |
| --- | --- | --- |
| `OPENCODE_START_TIMEOUT_MS` | `30000` | `opencode serve` 报告地址并响应 `/config` 的时限 |
| `MCP_TOOL_PREFIX` | `agent-workflow_` | opencode 中本项目 MCP 工具名的前缀 |
| `MCP_ASSISTANT_TOOL_PREFIX` | `agent-workflow-app_` | 助手 MCP 工具名的前缀；bridge 插件对两种前缀都注入会话 id |
| `MCP_SESSION_ARG` | `__aw_session` | bridge 插件注入的会话 id 参数名（12 §3） |
| `BASH_PERMISSION_PRESETS` | `auto` / `ask` 两套规则 | 执行者的会话级 bash 规则（12 §2） |
| `readonlyBashRules(checkCommands)` | 函数 | 规划与评审会话的会话级 bash 规则，`ask` 策略即不带检查命令的这一套（12 §2，D64） |

### 4.2 限制值（`constants/limits.ts`）

| 名称 | 值 |
| --- | --- |
| `PLAN_MAX_NODES` | 20 |
| `NODE_INSTRUCTIONS_MAX_CHARS` | 8000 |
| `REQUIREMENT_MAX_CHARS` | 20000 |
| `TASK_TITLE_MAX_CHARS` | 80（未填标题时由需求首行截取） |
| `ATTEMPT_MAX_NUDGES` | 1 |
| `ACCEPTANCE_COMMAND_TIMEOUT_MS` | 600000 |
| `ACCEPTANCE_OUTPUT_MAX_CHARS` | 20000（验收命令输出保留末尾这么多字符） |
| `DB_QUERY_MAX_ROWS` | 200 |
| `DB_QUERY_TIMEOUT_MS` | 15000 |
| `DB_CONNECT_TIMEOUT_MS` | 10000（建立到项目数据库的连接） |
| `TRANSCRIPT_PAGE_SIZE` | 200 |
| `TRANSCRIPT_TEXT_FLUSH_CHARS` | 200（流式文本每增长这么多字符写一次会话流） |
| `REPORT_PROGRESS_MAX_CHARS` | 200 |
| `RESULT_SUMMARY_MAX_CHARS` | 4000 |
| `SSE_REPLAY_BUFFER` | 1000（条） |
| `DIFF_FILE_MAX_BYTES` | 1048576（超过显示「文件过大」） |
| `RUNTIME_LOG_TAIL_DEFAULT` / `RUNTIME_LOG_TAIL_MAX` | 500 / 5000（运行环境日志页的行数） |
| `LIST_PAGE_DEFAULT` / `LIST_PAGE_MAX` | 50 / 100（任务与「需要你处理」列表每页条数，11 §1） |
| `ASSISTANT_TITLE_MAX_CHARS` | 40（助手对话标题取第一条消息的首行） |
| `ASSISTANT_MESSAGE_MAX_CHARS` | 20000（一条发给助手的消息） |

### 4.3 用户设置（`constants/settings.ts`，键 → 默认值）

| 键 | 默认 | 模式 |
| --- | --- | --- |
| `ui.mode` | `simple` | 简单 |
| `ui.theme` | `system` | 简单 |
| `ai.askOnUncertainty` | `false` | 简单 |
| `ai.defaultModel` | `null`（使用 opencode 默认模型） | 专业 |
| `ai.bashPolicy` | `auto`（助手不能修改，D65） | 专业 |
| `scheduler.maxConcurrentAttempts` | `4` | 简单 |
| `scheduler.maxConcurrentNodesPerTask` | `2` | 专业 |
| `node.maxAttempts` | `3` | 专业 |
| `attempt.timeoutMinutes` | `60` | 专业 |
| `worktree.rootDir` | `null`（使用 `<数据目录>/worktrees`；助手不能修改，D65） | 专业 |
| `delivery.defaultStrategy` | `squash`（可选 `squash` / `merge` / `rebase`；PR 有单独按钮） | 专业 |
| `delivery.deleteBranchAfterMerge` | `true` | 专业 |
| `opencode.binaryPath` | `null`（从 PATH 与 `~/.opencode/bin` 查找；助手不能修改，D65） | 专业 |
| `assistant.alwaysAllow` | `[]`（操作 id 列表；只有 write 级生效，critical 即使在列表中也每次确认；助手自己不能修改，D65；v1.1） | 简单 |

「模式」列表示该设置在哪种界面模式下出现在设置页（常量 `SETTING_MODE`）。值的 schema 为 `settingsSchema`（strict：未知键拒绝），默认值为 `SETTING_DEFAULTS`。

## 5. 错误码

### 5.1 结构

```ts
// erasableSyntaxOnly（D29）：不用参数属性，字段显式声明
class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.code = code;
    this.details = details;
  }
}
```

- HTTP 响应：`{ "error": { "code": "TASK_NOT_FOUND", "message": "...", "details": {...} } }`，HTTP 状态取自错误码表。
- MCP 响应：`{ isError: true, content: [{ type: "text", text: JSON.stringify({ code, message, hint, details }) }] }`。`hint` 写给模型看：怎么改才能成功。
- `message` 面向开发者（英文）；用户可见文案由前端按 `code` 查 `copy/errors.ts`（`Record<ErrorCode, string>`，每个码都有文案，单测校验两表的键一致）。
- 只有下表中的码；新增必须加表。未预期异常统一为 `INTERNAL_ERROR`，日志记录完整堆栈。

### 5.2 错误码表（`errors/codes.ts`）

| code | HTTP | 含义 |
| --- | --- | --- |
| **通用** | | |
| `VALIDATION_FAILED` | 400 | 请求/工具参数不符合 schema；`details.issues` 为 zod issues |
| `NOT_FOUND` | 404 | 通用资源不存在（优先用具体码） |
| `STATE_TRANSITION_INVALID` | 409 | 当前状态不允许该操作；`details: { entity, from, event }` |
| `UNAUTHORIZED` | 401 | 令牌缺失或错误 |
| `INTERNAL_ERROR` | 500 | 未预期异常 |
| **项目** | | |
| `PROJECT_NOT_FOUND` | 404 | |
| `PROJECT_PATH_NOT_GIT_REPO` | 400 | 选择的目录不是 Git 仓库根目录 |
| `PROJECT_ALREADY_EXISTS` | 409 | 同一仓库路径已添加 |
| `PROJECT_HAS_ACTIVE_TASKS` | 409 | 删除项目时存在非终态任务 |
| **Git / worktree** | | |
| `GIT_NOT_INSTALLED` | 500 | |
| `GIT_COMMAND_FAILED` | 500 | `details: { args, exitCode, stderr }` |
| `GIT_BASE_BRANCH_NOT_FOUND` | 400 | |
| `WORKTREE_CREATE_FAILED` | 500 | |
| `WORKTREE_DIRTY` | 409 | 合并前 worktree 有未提交改动（正常流程由后端自动提交，出现即缺陷或用户手动改动） |
| **托管平台** | | |
| `HOSTING_NOT_CONFIGURED` | 400 | 选择 PR 交付但项目未绑定远端 |
| `HOSTING_AUTH_FAILED` | 401 | 令牌无效或权限不足 |
| `HOSTING_API_ERROR` | 502 | `details: { status, body }` |
| **流程 / 角色** | | |
| `WORKFLOW_NOT_FOUND` | 404 | |
| `WORKFLOW_READONLY` | 409 | 修改内置流程 |
| `WORKFLOW_DEFINITION_INVALID` | 400 | `details.problems[]`，子码见 5.4 |
| `WORKFLOW_ALREADY_EXISTS` | 409 | 新建 / 复制流程时 key 已被列出的流程使用 |
| `ROLE_NOT_FOUND` | 404 | |
| `ROLE_READONLY` | 409 | |
| `ROLE_IN_USE` | 409 | 删除被流程引用或被任务步骤 / 会话使用过的角色；`details: { workflows[], usedByTasks }` |
| `ROLE_ALREADY_EXISTS` | 409 | 新建 / 复制角色时 key 已存在 |
| **任务 / 计划 / 节点** | | |
| `TASK_NOT_FOUND` | 404 | |
| `PLAN_NOT_FOUND` | 404 | |
| `PLAN_VERSION_CONFLICT` | 409 | 编辑基于的版本不是最新草稿 |
| `PLAN_INVALID` | 400 | 计划图校验失败；`details.problems[]`，每项 `{ code, nodeKey?, message }`，子码见 5.3 |
| `NODE_NOT_FOUND` | 404 | |
| `NODE_NOT_EDITABLE` | 409 | 调整计划时修改了已开始的节点 |
| `NODE_ATTEMPTS_EXHAUSTED` | — | 节点用完重试预算仍未通过（记录在任务的 `failure` 上，不作为 HTTP 错误）；`details: { nodeKey, nodeTitle, feedback }` |
| **尝试 / opencode** | | |
| `ATTEMPT_NOT_FOUND` | 404 | |
| `ATTEMPT_NO_RESULT` | — | 会话结束但未提交结果（记录在尝试上，不作为 HTTP 错误） |
| `ATTEMPT_TIMEOUT` | — | 超过 `attempt.timeoutMinutes` |
| `ATTEMPT_SESSION_ERROR` | — | opencode `session.error`；`details` 为原始错误 |
| `OPENCODE_NOT_READY` | 503 | 运行时不是 `ready` |
| `OPENCODE_REQUEST_FAILED` | 502 | 调 opencode API 失败 |
| **MCP 专用** | | |
| `MCP_ATTEMPT_UNRESOLVED` | — | 无法从调用解析到活动尝试 |
| `MCP_TOOL_NOT_ALLOWED` | — | 当前尝试类型不允许此工具 |
| `MCP_RESULT_ALREADY_SUBMITTED` | — | 同一尝试重复提交结果/计划/评审 |
| `MCP_NODE_NOT_FOUND` | — | `get_node_output` 的 node_key 不存在或未完成 |
| `MCP_CONVERSATION_UNRESOLVED` | — | 助手 MCP：调用的会话不属于任何助手对话（如执行任务的会话） |
| **助手（v1.1）** | | |
| `ASSISTANT_CONVERSATION_NOT_FOUND` | 404 | |
| `ASSISTANT_CONFIRMATION_NOT_FOUND` | 404 | |
| `ASSISTANT_BUSY` | 409 | 助手正在回复时又发来消息（先等它结束或停止它） |
| **Inbox** | | |
| `INBOX_ITEM_NOT_FOUND` | 404 | |
| `INBOX_ITEM_CLOSED` | 409 | 条目已处理 |
| **交付** | | |
| `DELIVERY_CONFLICT` | 409 | 合并冲突；`details.files[]`（记录在冲突的 delivery 的 `error` 上，`deliver` 本身返回任务 DTO） |
| `DELIVERY_TARGET_NOT_FOUND` | 400 | 目标分支不存在 |
| `DELIVERY_TARGET_DIRTY` | 409 | 目标分支检出在某个工作区（通常是用户的主工作区）且有未提交改动，拒绝合并；`details: { path, branch, files[] }` |
| `DELIVERY_INTERRUPTED` | — | 应用在交付过程中退出（记录在 delivery 上，重启后任务回到 `review`） |
| **数据库** | | |
| `DB_CONNECTION_NOT_FOUND` | 404 | 不存在，或（MCP 工具）不是任务项目关联的连接 |
| `DB_CONNECTION_ALREADY_EXISTS` | 409 | 连接名称已被使用（MCP 工具按名称找连接） |
| `DB_CONNECTION_FAILED` | 502 | `details.driverMessage` |
| `DB_QUERY_REJECTED` | 400 | 非只读语句 |
| `DB_QUERY_TIMEOUT` | 504 | |
| `DB_QUERY_FAILED` | 400 | SQL 错误；`details.driverMessage` |
| **凭据** | | |
| `CREDENTIAL_UNAVAILABLE` | 500 | safeStorage 不可用或解密失败 |

### 5.3 计划校验子码（`PLAN_INVALID.details.problems[].code`）

枚举 `PlanProblemCode`，hint 为常量 `PLAN_PROBLEM_HINT`（英文，给模型看）；校验函数 `validatePlanGraph(graph, { allowedRoles, requiredSteps })` 位于 `shared/workflow`，一次返回全部问题。存在环时不检查必经步骤顺序。

| 子码 | 含义 | 给模型的 hint |
| --- | --- | --- |
| `EMPTY` | 没有节点 | 至少提交一个节点 |
| `TOO_MANY_NODES` | 超过 `PLAN_MAX_NODES` | 合并相近步骤 |
| `DUPLICATE_KEY` | 节点 key 重复 | key 在计划内唯一 |
| `UNKNOWN_DEPENDENCY` | depends_on 指向不存在的 key | 检查拼写 |
| `CYCLE` | 存在环；`details.cycle[]` | 去掉形成环的依赖 |
| `UNKNOWN_ROLE` | 角色不在流程允许列表；`details.allowedRoles[]` | 从允许列表中选 |
| `MISSING_REQUIRED_STEP` | 缺少流程要求的必经步骤；`details.requiredStep` | 补上该步骤 |
| `REQUIRED_STEP_ORDER` | 必经步骤位置不符（`first` 须被所有节点传递依赖，`last` 须传递依赖所有节点） | 调整 depends_on |
| `INSTRUCTIONS_TOO_LONG` | 指令超长 | 精简 |

### 5.4 流程定义校验子码（`WORKFLOW_DEFINITION_INVALID.details.problems[].code`）

枚举 `WorkflowProblemCode`（`shared/errors/workflow-problems.ts`）；校验函数 `validateWorkflowDefinition({ planning, definition }, roles)` 位于 `shared/workflow`，流程编排器与后端（`POST /workflows/validate`、新建、修改）共用。每项带 `field`（`allowedRoles` / `plannerRole` / `template` / `requiredSteps`）。固定流程的模板按 5.3 的计划校验（允许角色为流程的 `allowedRoles`，无必经步骤），必经步骤检查重复 key（`DUPLICATE_KEY`）、角色是否允许（`UNKNOWN_ROLE`）、指令长度（`INSTRUCTIONS_TOO_LONG`），这些沿用 5.3 的子码。

| 子码 | 含义 |
| --- | --- |
| `NO_ALLOWED_ROLES` | 允许的角色为空 |
| `ROLE_NOT_FOUND` | 允许列表或规划者中的角色不存在；`details.role` |
| `MISSING_PLANNER` | AI 规划流程没有规划者角色 |
| `PLANNER_ROLE_INVALID` | 规划者角色的 `base_agent` 不是 `planner` |
| `MISSING_TEMPLATE` | 固定流程没有模板 |
