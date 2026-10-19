# 12 · 执行 MCP 工具与 opencode 集成

> 本文描述**执行 MCP**（`/mcp/exec`），供执行开发任务的 AI 会话使用。应用助手使用的**助手 MCP**（v1.1）见 [15-assistant.md](15-assistant.md)，两者令牌与权限隔离。

## 1. 职责边界

- **opencode 原生工具**（read / edit / write / bash / grep / glob …）负责读写代码、跑命令。会话 `directory` = 任务 worktree。
- **本项目 MCP 工具**负责：取上下文、提交计划/结果/评审、向用户提问、上报进度、读任务 diff、数据库只读查询。
- 模型**不做任何 Git 写操作**：节点完成时由后端提交；合并冲突由后端先在 worktree 执行 `git merge <target>`，模型只负责改冲突文件（见 13 的 `revise` 节点）。
- 工具失败返回结构化错误码 + hint，模型据此修正后重试；工具层不做静默兜底。

## 2. 注入到 opencode 的配置

后端启动 opencode 时通过 `OPENCODE_CONFIG_CONTENT` 注入（与用户自己的全局 opencode 配置合并，用户的模型登录/provider 原样复用）：

```jsonc
{
  "mcp": {
    "agent-workflow": {
      "type": "remote",
      "url": "http://127.0.0.1:<apiPort>/mcp/exec",
      "headers": { "Authorization": "Bearer <mcpToken>" },
      "oauth": false,
      "enabled": true
    }
  },
  "plugin": ["file://<appResources>/opencode-plugin/agent-workflow-bridge.js"],
  "agent": {
    "aw-planner":  { "mode": "primary", "description": "agent-workflow planner",  "prompt": "<protocol-plan.md>",    "permission": { "edit": "deny",  "question": "deny", "webfetch": "deny", "external_directory": "deny" } },
    "aw-executor": { "mode": "primary", "description": "agent-workflow executor", "prompt": "<protocol-execute.md>", "permission": { "edit": "allow", "question": "deny", "webfetch": "ask",  "external_directory": "deny" } },
    "aw-reviewer": { "mode": "primary", "description": "agent-workflow reviewer", "prompt": "<protocol-review.md>",  "permission": { "edit": "deny",  "question": "deny", "webfetch": "deny", "external_directory": "deny" } }
  }
}
```

- agent 只放不随设置变化的权限；**bash 规则在 `session.create` 时以会话级 `permission` 规则集传入**（D35），格式 `[{ permission: 'bash', pattern, action }]`。
- 原生 `question` 工具禁用，提问只走 MCP `ask_user`（D36）。
- **bash 规则集**（常量 `BASH_PERMISSION_PRESETS`，在 `shared/constants/opencode.ts`；reviewer 与 planner 用只读白名单，executor 按 `ai.bashPolicy`）：
  - 只读白名单：`ls* cat* head* tail* rg* grep* find* wc* git status* git log* git diff* git show*` 为 allow，其余 ask。
  - `ai.bashPolicy = auto`（默认）：`*` allow；`git commit* git push* git checkout* git switch* git reset* git rebase* git merge* git branch -D* git worktree*` deny。
  - `ai.bashPolicy = ask`：只读白名单 allow，其余 ask。
- 角色差异不靠多个 agent：会话使用角色的 `base_agent` 对应的 agent，角色提示词通过每次 prompt 的 `system` 字段追加，模型通过 prompt 的 `model` 字段指定。因此修改角色无需重启 opencode。
- 修改 `ai.bashPolicy` 对之后新建的会话立即生效，无需重启 opencode。

## 3. 调用归属（哪个尝试在调用工具）

MCP 连接在 opencode 内是全局的，请求头无法区分会话，因此：

- 插件 `agent-workflow-bridge`（S1 已验证，D33）在 `tool.execute.before` 钩子中，对名称以 `agent-workflow_` 开头的工具**原地修改** `output.args.__aw_session = input.sessionID`（给 `output.args` 重新赋值不会生效）。MCP 服务端在 zod 校验前取出该字段，按 `attempts.opencode_session_id` 找到 `starting/running` 状态的尝试。
- 模型在后续调用中可能自己照抄 `__aw_session`，钩子总会用真实 sessionID 覆盖，因此不影响归属。
- 插件按 opencode 的目录实例各加载一次（每个 worktree 一次），实现须无状态。
- 插件以构建后的 JS 随安装包放在 `Resources/opencode-plugin/`（M2-03）。
- 解析失败 → `MCP_ATTEMPT_UNRESOLVED`；工具不允许用于该尝试类型 → `MCP_TOOL_NOT_ALLOWED`。

## 4. 会话协议

### 4.1 尝试开始

1. `POST /session?directory=<worktree>` 创建会话，标题 `<taskKey> · <节点标题>`。
2. `POST /session/{id}/prompt_async?directory=<worktree>`：
   - `agent`：`aw-planner` / `aw-executor` / `aw-reviewer`
   - `model`：角色模型 > 设置 `ai.defaultModel` > 省略（opencode 默认）
   - `system`：角色提示词
   - `parts`：首条消息（模板在 `packages/builtin/prompts/start-<kind>.md`），包含需求、本节点指令、上次失败反馈（如有）、`ask_on_uncertainty` 的当前取值说明，并要求先调用 `get_task_context`。
3. 尝试 `starting → running`。

### 4.2 结束条件

| 情况 | 处理 |
| --- | --- |
| 调用 `submit_plan` / `submit_result` / `submit_review` 成功 | 尝试 `succeeded`；后端随后中止会话的后续生成（若仍在生成） |
| `session.idle` 且有未回答的阻塞问题 | 节点 `waiting_input`；回答后 `prompt_async` 发送答案（`start-answer.md` 模板） |
| `session.idle` 且未提交、无问题 | 发送提醒（`nudge.md`），`nudges+1`；超过 `ATTEMPT_MAX_NUDGES` → `failed / ATTEMPT_NO_RESULT` |
| `session.error` | `failed / ATTEMPT_SESSION_ERROR` |
| 超时 | 中止会话，`failed / ATTEMPT_TIMEOUT` |

### 4.3 规划会话的复用

`plan` 类尝试：用户在 `plan_review` 选择「按反馈重新规划」时，在**同一会话**发送反馈消息并新建一条 `plan` 类尝试记录指向同一 `opencode_session_id`（上一条已 `succeeded`，归属解析只匹配活动尝试，不冲突）。

## 5. 错误返回格式

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"PLAN_INVALID\",\"message\":\"Plan graph is invalid\",\"hint\":\"Fix the listed problems and call submit_plan again.\",\"details\":{\"problems\":[{\"code\":\"CYCLE\",\"message\":\"a -> b -> a\"}]}}" }]
}
```

成功返回：`{ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output }`。

## 6. 工具清单

| 工具 | 允许的尝试类型 | 作用 |
| --- | --- | --- |
| `get_task_context` | plan · execute · review | 取完整上下文 |
| `get_node_output` | plan · execute · review | 取某个已完成节点的完整产出 |
| `get_task_diff` | execute · review | 当前 worktree 相对基线的改动 |
| `submit_plan` | plan | 提交计划 |
| `submit_result` | execute | 提交节点结果 |
| `submit_review` | review | 提交评审结论 |
| `ask_user` | plan · execute | 向用户提问 |
| `report_progress` | plan · execute · review | 上报一句当前进展 |
| `db_list_connections` | plan · execute · review | 列出项目关联的数据库 |
| `db_describe` | plan · execute · review | 查看表结构 |
| `db_query` | plan · execute · review | 只读查询 |

工具名在 opencode 中显示为 `agent-workflow_<name>`。输入/输出 schema 位于 `shared/contracts/mcp/<tool>.ts`；下文用 TS 类型描述。

---

### 6.1 `get_task_context`

输入：`{}`

输出：

```ts
{
  task: { key: string; title: string; requirement: string; workflow: string; deliverable: 'code_changes' | 'report' };
  project: { name: string; defaultBranch: string };
  workspace: { path: string; branch: string; baseCommit: string };
  attempt: { kind: AttemptKind; seq: number; retryFeedback?: string };
  askOnUncertainty: boolean;
  plan?: { version: number; summary?: string; nodes: Array<{ key; title; role; status; dependsOn; resultSummary? }> };
  node?: { key; title; role; instructions; acceptance: Acceptance; dependsOn: string[] };
  upstream: Array<{ key; title; summary: string; changedFiles: string[] }>;   // 直接依赖节点
  answeredQuestions: Array<{ question: string; answer: string }>;             // 本任务内已回答/已假设
  userFeedback: string[];                                                     // 重新规划 / 再改改 / 驳回意见，按时间
  planning?: { guidance?: string; allowedRoles: Array<{ key; name; description }>; requiredSteps: PlanNodeSpec[]; maxNodes: number };  // 仅 plan 类
  databases: Array<{ name: string; type: 'mysql' }>;
}
```

错误：`MCP_ATTEMPT_UNRESOLVED`。

### 6.2 `get_node_output`

输入：`{ node_key: string }`
输出：`{ key, title, summary, changes: Array<{ path; description }>, notes?, assumptions: string[], checkResults: Array<{ kind; passed; output }> }`
错误：`MCP_NODE_NOT_FOUND`（不存在或未 `done`）。

### 6.3 `get_task_diff`

输入：`{ path?: string }`
输出：无 path 时 `{ files: Array<{ path; status: 'added'|'modified'|'deleted'|'renamed'; additions; deletions }> }`；有 path 时 `{ path, diff: string }`（未提交改动 + 已提交改动，相对 `baseCommit`）。
错误：`VALIDATION_FAILED`（path 不在 diff 中）。

### 6.4 `submit_plan`

输入：

```ts
{
  summary: string;                       // 给用户看的计划说明，1..2000
  assumptions?: string[];                // 规划时做出的假设
  nodes: Array<{
    key: string;                         // [a-z0-9_]{1,40}
    title: string;                       // 1..60
    role: string;                        // 角色 key，须在 allowedRoles 内
    instructions: string;                // 1..NODE_INSTRUCTIONS_MAX_CHARS
    depends_on?: string[];
    acceptance?: { command?: string; ai_review?: boolean; manual?: boolean };
  }>;
}
```

行为：校验（08 §5.3 子码）→ 通过则创建 `draft` 计划版本（`source=ai`），尝试 `succeeded`，任务发 `plan_submitted`。`requiredSteps` 中的节点若未出现由校验报 `MISSING_REQUIRED_STEP`（模型须原样包含，可改 instructions 不可改 key/role）。
输出：`{ version: number, accepted: true }`
错误：`PLAN_INVALID`（details.problems）、`MCP_RESULT_ALREADY_SUBMITTED`、`MCP_TOOL_NOT_ALLOWED`。

### 6.5 `submit_result`

输入：

```ts
{
  summary: string;                       // 做了什么，1..4000，Markdown
  changes?: Array<{ path: string; description: string }>;
  assumptions?: string[];                // 本节点做出的假设（未问用户时必须写明）
  notes?: string;                        // 给后续节点/用户的注意事项
  self_check?: { tests_run: boolean; tests_passed?: boolean; details?: string };
}
```

行为：写入节点 `result`；尝试 `succeeded`；节点发 `result_submitted` 进入验收。
输出：`{ accepted: true, next: 'verifying' | 'awaiting_acceptance' | 'done' }`
错误：`MCP_RESULT_ALREADY_SUBMITTED`、`VALIDATION_FAILED`。

### 6.6 `submit_review`

输入：

```ts
{
  verdict: 'pass' | 'fail';
  summary: string;
  issues?: Array<{ severity: 'blocker' | 'major' | 'minor'; path?: string; line?: number; description: string }>;
}
```

行为：作为被评审节点的一条 `ai_review` 检查结果；`fail` 时 issues 作为该节点的 `retryFeedback`。`verdict = fail` 但无 `blocker/major` issue → `VALIDATION_FAILED`（hint：失败必须给出至少一个 blocker 或 major 问题）。
输出：`{ accepted: true }`

### 6.7 `ask_user`

输入：

```ts
{
  question: string;                      // 1..1000
  options?: string[];                    // 2..6 个选项，用户也可自由回答
  blocking: boolean;                     // 不得到答案就无法继续
  default_assumption?: string;           // 不问用户时将采用的假设
}
```

行为：

| 条件 | 结果 |
| --- | --- |
| `askOnUncertainty = false` 且提供 `default_assumption` | 写一条已 resolved 的 question 记录（`assumed`），返回 `{ status: 'assumed', proceed_with: default_assumption }` |
| `askOnUncertainty = false` 且 `blocking = false` 且无 `default_assumption` | `VALIDATION_FAILED`，hint：提供 default_assumption 后继续 |
| 其他（需要问） | 创建 open question；`blocking=true` 返回 `{ status: 'queued', instruction: 'End your turn now. The answer will be sent as the next message.' }`；`blocking=false` 返回 `{ status: 'queued', instruction: 'Continue working; the answer will be sent when available.' }` |

`askOnUncertainty = false` 且 `blocking = true` 且无默认假设：仍然提问（确实无法继续时不强行假设）。

### 6.8 `report_progress`

输入：`{ message: string }`（1..200）
行为：更新节点（或任务规划阶段）的「当前进展」一行，推送 SSE；不写库历史。
输出：`{ ok: true }`

### 6.9 `db_list_connections`

输入：`{}`
输出：`{ connections: Array<{ name: string; type: 'mysql'; database: string }> }`（仅项目关联的；不含主机、用户、密码）

### 6.10 `db_describe`

输入：`{ connection: string; table?: string }`
输出：无 table 时 `{ tables: Array<{ name; comment?; rows?: number }> }`；有 table 时 `{ columns: Array<{ name; type; nullable; key?; default?; comment? }>, indexes: Array<{ name; columns: string[]; unique: boolean }> }`
错误：`DB_CONNECTION_NOT_FOUND`、`DB_CONNECTION_FAILED`、`VALIDATION_FAILED`（表不存在）。

### 6.11 `db_query`

输入：`{ connection: string; sql: string; limit?: number }`（limit ≤ `DB_QUERY_MAX_ROWS`）
行为：只允许单条 `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN`（解析首关键字并拒绝多语句）；在 `START TRANSACTION READ ONLY` 中执行；超时 `DB_QUERY_TIMEOUT_MS`；结果截断到 limit。
输出：`{ columns: string[], rows: unknown[][], truncated: boolean, elapsedMs: number }`
错误：`DB_QUERY_REJECTED`、`DB_QUERY_TIMEOUT`、`DB_QUERY_FAILED`、`DB_CONNECTION_FAILED`。

## 7. 实现结构

```
modules/mcp/
├─ mcp.server.ts        McpServer + StreamableHTTPServerTransport，挂载到 Fastify /mcp/exec；校验执行 MCP 令牌
├─ mcp.registry.ts      工具注册表：definition → 自动生成 tools/list，统一做归属解析、类型授权、zod 校验、错误映射
├─ mcp.context.ts       解析 __aw_session → AttemptContext
└─ tools/
   ├─ get-task-context.tool.ts
   ├─ submit-plan.tool.ts
   └─ ...
```

```ts
export const submitPlanTool = defineMcpTool({
  name: 'submit_plan',
  allowedKinds: [AttemptKind.Plan],
  input: submitPlanInputSchema,
  output: submitPlanOutputSchema,
  hint: { PLAN_INVALID: 'Fix the listed problems and call submit_plan again.' },
  handler: (input, ctx) => ctx.services.plans.submitFromAttempt(ctx.attempt, input),
});
```

工具 handler 只做参数到 service 的转发；业务规则在 service 中，与 REST 共用。

## 8. opencode 1.19.0 实测记录（M0）

| 项 | 结论 |
| --- | --- |
| SDK | 使用 `@opencode-ai/sdk/v2` 的 `createOpencodeClient({ baseUrl })`；方法参数为扁平对象（如 `session.promptAsync({ sessionID, directory, agent, model: { providerID, modelID }, system, parts })`） |
| 启动 | `opencode serve --hostname 127.0.0.1 --port 0 --print-logs --log-level WARN`，从 stdout/stderr 解析 `http://127.0.0.1:<port>` |
| 配置合并 | `OPENCODE_CONFIG_CONTENT` 与用户全局配置合并；`config.get({ directory })` 可见注入的 mcp / agent / plugin；`mcp.status` 为 `connected` |
| 会话 | `session.create({ directory, title, agent, permission })`；同一服务两个目录并发互不干扰 |
| 事件 | `global.event()` 为全局流，每条带 `directory`；`event.subscribe({ directory })` 只含该目录事件。实测事件类型：`session.created/updated/status/idle/diff`、`message.updated`、`message.part.updated/delta`、`permission.asked/replied`、`file.edited`、`server.heartbeat` 等 |
| 权限 | `permission.asked` → `permission.reply({ requestID, directory, reply })` 后会话继续 |
| 数据目录 | opencode 会话存于用户自己的 opencode 数据目录（与用户 TUI 共享，登录凭据也在那里），本应用不隔离；会话标题带任务编号便于辨认 |
| 免费模型 | 开发与 `@opencode` 集成测试默认 `opencode/glm-5.3-flash-free`，不产生费用 |
