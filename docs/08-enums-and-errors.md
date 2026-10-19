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
| `DbType` | `mysql` |
| `CredentialKind` | `git_token` · `db_password` |
| `TranscriptEntryKind` | `user_message` · `text` · `reasoning` · `tool_call` · `tool_result` · `file_edit` · `permission` · `system` · `error` |
| `BashPolicy` | `auto`（默认放行，禁止 Git 写操作）· `ask`（只读命令放行，其余询问） |
| `OperationRisk` | `read` · `write` · `critical`（操作清单风险等级，决定助手确认行为，见 15 §4） |
| `ServerEventType` | 见 [11-api.md §11](11-api.md#11-sse-事件) |

## 3. 状态 → 语气映射（`STATUS_TONE`）

`STATUS_TONE.task` / `.node` / `.attempt` / `.taskDisplay`（类型保证每个值都有映射，单测再校验一次）：

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
| `MCP_ASSISTANT_SERVER_NAME` | `agent-workflow-app` | 助手 MCP（v1.1） |
| `TASK_KEY_PREFIX` | `T-` | 任务编号 `T-<自增>` |
| `BRANCH_PREFIX` | `aw/` | 分支名 `aw/<taskKey>-<slug>` |
| `BRANCH_SLUG_MAX` | `40` | slug 由标题转写，只保留 `[a-z0-9-]`（`toSlug`，`shared/naming.ts`） |
| `PROJECT_SLUG_MAX` | `40` | 项目 slug（worktree 目录名）由名称转写；无 ASCII 字符时为 `project`，重名追加 `-2`、`-3` |
| `API_PREFIX` | `/api/v1` | |
| `DEV_API_PORT` / `DEV_WEB_PORT` | `47821` / `47822` | 仅开发；生产后端随机端口（D31） |
| `MCP_EXEC_PATH` | `/mcp/exec` | |
| `MCP_ASSISTANT_PATH` | `/mcp/assistant` | v1.1 |

### 4.2 限制值（`constants/limits.ts`）

| 名称 | 值 |
| --- | --- |
| `PLAN_MAX_NODES` | 20 |
| `NODE_INSTRUCTIONS_MAX_CHARS` | 8000 |
| `REQUIREMENT_MAX_CHARS` | 20000 |
| `ATTEMPT_MAX_NUDGES` | 1 |
| `ACCEPTANCE_COMMAND_TIMEOUT_MS` | 600000 |
| `DB_QUERY_MAX_ROWS` | 200 |
| `DB_QUERY_TIMEOUT_MS` | 15000 |
| `TRANSCRIPT_PAGE_SIZE` | 200 |
| `SSE_REPLAY_BUFFER` | 1000（条） |
| `DIFF_FILE_MAX_BYTES` | 1048576（超过显示「文件过大」） |

### 4.3 用户设置（`constants/settings.ts`，键 → 默认值）

| 键 | 默认 | 模式 |
| --- | --- | --- |
| `ui.mode` | `simple` | 简单 |
| `ui.theme` | `system` | 简单 |
| `ai.askOnUncertainty` | `false` | 简单 |
| `ai.defaultModel` | `null`（使用 opencode 默认模型） | 专业 |
| `ai.bashPolicy` | `auto` | 专业 |
| `scheduler.maxConcurrentAttempts` | `4` | 简单 |
| `scheduler.maxConcurrentNodesPerTask` | `2` | 专业 |
| `node.maxAttempts` | `3` | 专业 |
| `attempt.timeoutMinutes` | `60` | 专业 |
| `worktree.rootDir` | `null`（使用 `<数据目录>/worktrees`） | 专业 |
| `delivery.defaultStrategy` | `squash`（可选 `squash` / `merge` / `rebase`；PR 有单独按钮） | 专业 |
| `delivery.deleteBranchAfterMerge` | `true` | 专业 |
| `opencode.binaryPath` | `null`（从 PATH 与 `~/.opencode/bin` 查找） | 专业 |
| `assistant.alwaysAllow` | `[]`（操作 id 列表，仅 write 级可加入；v1.1） | 简单 |

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
- `message` 面向开发者（英文）；用户可见文案由前端按 `code` 查 `copy/errors.ts`，查不到时显示通用文案 + code。
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
| `WORKFLOW_DEFINITION_INVALID` | 400 | `details.problems[]` |
| `ROLE_NOT_FOUND` | 404 | |
| `ROLE_READONLY` | 409 | |
| `ROLE_IN_USE` | 409 | 删除被流程引用的角色 |
| **任务 / 计划 / 节点** | | |
| `TASK_NOT_FOUND` | 404 | |
| `PLAN_NOT_FOUND` | 404 | |
| `PLAN_VERSION_CONFLICT` | 409 | 编辑基于的版本不是最新草稿 |
| `PLAN_INVALID` | 400 | 计划图校验失败；`details.problems[]`，每项 `{ code, nodeKey?, message }`，子码见 5.3 |
| `NODE_NOT_FOUND` | 404 | |
| `NODE_NOT_EDITABLE` | 409 | 调整计划时修改了已开始的节点 |
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
| **Inbox** | | |
| `INBOX_ITEM_NOT_FOUND` | 404 | |
| `INBOX_ITEM_CLOSED` | 409 | 条目已处理 |
| **交付** | | |
| `DELIVERY_CONFLICT` | 409 | 合并冲突；`details.files[]` |
| `DELIVERY_TARGET_NOT_FOUND` | 400 | 目标分支不存在 |
| **数据库** | | |
| `DB_CONNECTION_NOT_FOUND` | 404 | |
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
