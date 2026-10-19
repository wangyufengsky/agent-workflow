# 11 · 后端 REST API 与 SSE 事件

## 1. 约定

- 基址：相对路径 `/api/v1`。前端页面由后端同源托管（开发时 Vite 代理到 `DEV_API_PORT`，D31）；令牌由 preload 提供（`window.aw.apiToken`），浏览器开发/E2E 模式用 `VITE_AW_API_TOKEN`。
- 认证：`Authorization: Bearer <apiToken>`；缺失或错误 → 401 `UNAUTHORIZED`。
- 请求与响应均为 JSON，字段 `camelCase`；枚举值为 `snake_case` 字符串；时间为毫秒时间戳。
- 除 SSE、会话流、diff 文件内容等少数流式接口外，端点都由**操作清单**挂载（[03 §5](03-architecture.md#5-操作清单operation-registry)）：每个端点对应一个操作 id，schema 位于 `shared/operations/<domain>.ts`，路由、前端客户端、命令面板、v1.1 助手共用，**本文与清单不一致以清单为准并修正本文**。
- 成功：`200` 返回资源或 `{ items, nextCursor }`；创建返回 `201`；无内容返回 `204`。
- 失败：`{ "error": { "code", "message", "details"? } }`，状态码见 [08 §5](08-enums-and-errors.md#5-错误码)。
- 命令型操作（start / cancel / deliver…）用 `POST /资源/:id/<动词>`，返回操作后的完整资源 DTO，前端直接用它更新缓存。
- 分页：`?limit=<1..100，默认 50>&cursor=<不透明字符串>`。
- 不做幂等键与回执：本地同步事务，重复点击由状态机拒绝（`STATE_TRANSITION_INVALID`），前端按钮在请求期间禁用。

标记：🅿 = 仅专业模式界面使用（API 本身不区分模式）。

## 2. 系统与设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/system/environment` | 环境检测结果 `EnvironmentDTO` |
| POST | `/system/environment/recheck` | 重新检测（安装 opencode 后用） |
| GET | `/system/runtime` | `RuntimeDTO`：opencode 状态、版本、地址、启动时间、活动会话数 |
| POST | `/system/runtime/restart` | 重启 opencode（先中止活动尝试） |
| GET | `/system/runtime/logs?tail=500` 🅿 | opencode 日志末尾若干行 |
| GET | `/system/storage` | 数据目录占用 |
| GET | `/settings` | 全部设置 `Record<SettingKey, value>` |
| PATCH | `/settings` | 部分更新；按 key 的 schema 校验 |

```ts
type EnvironmentDTO = {
  git: { installed: boolean; version?: string };
  opencode: { status: RuntimeStatus; path?: string; version?: string; requiredVersion: '1.19.0' };
  models: { available: Array<{ providerId: string; modelId: string; name: string }>; defaultModel?: string };
  ready: boolean;              // 三项都满足
};
```

`models` 来自 opencode `/config/providers`，用于引导页判断「是否已登录至少一个模型提供方」。

## 3. 项目

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects` | 列表 |
| POST | `/projects` | `{ repoPath, name? }`；校验是 Git 仓库根目录，读取默认分支 |
| GET | `/projects/:id` | `ProjectDTO`（含远端绑定摘要、关联数据库、活动任务数） |
| PATCH | `/projects/:id` | `{ name?, defaultBranch?, checkCommand? }` |
| DELETE | `/projects/:id` | 有非终态任务时 409 `PROJECT_HAS_ACTIVE_TASKS` |
| PUT | `/projects/:id/hosting` | `{ provider, baseUrl?, repo, token }`；保存前调用平台 API 验证令牌 |
| DELETE | `/projects/:id/hosting` | 解除绑定并删除凭据 |
| PUT | `/projects/:id/db-connections` 🅿 | `{ connectionIds: string[] }` 覆盖关联 |

远端 `repo` 默认从 `git remote get-url origin` 推断，前端预填。

## 4. 流程与角色

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/workflows` | 最新版本列表 |
| GET | `/workflows/:id` | 某版本详情（含 `definition`） |
| GET | `/workflows/by-key/:key/versions` 🅿 | 版本历史 |
| POST | `/workflows` 🅿 | 新建自定义流程 `{ key, name, description, planning, deliverable, definition }`；或 `{ copyFrom: workflowId, key, name }` |
| PUT | `/workflows/:id` 🅿 | 产生新版本，返回新版本；内置流程 409 `WORKFLOW_READONLY` |
| DELETE | `/workflows/by-key/:key` 🅿 | 仅自定义；已被任务引用的版本保留（标记删除，不在列表出现） |
| POST | `/workflows/validate` 🅿 | 校验定义，返回 `{ problems[] }`（编辑器实时校验用） |
| GET | `/roles` | 列表 |
| POST | `/roles` 🅿 | 新建或 `{ copyFrom }` |
| PUT | `/roles/:id` 🅿 | 内置 409 `ROLE_READONLY` |
| DELETE | `/roles/:id` 🅿 | 被最新版流程引用时 409 `ROLE_IN_USE` |

## 5. 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tasks?projectId&status&displayGroup&limit&cursor` | `TaskSummaryDTO[]`，按 `updatedAt` 倒序 |
| POST | `/tasks` | 创建，见下 |
| GET | `/tasks/:id` | `TaskDetailDTO` |
| GET | `/tasks/:id/timeline?afterId` | `task_events` 分页 |
| POST | `/tasks/:id/start` | `draft → preparing` |
| POST | `/tasks/:id/pause` 🅿 | `running → paused` |
| POST | `/tasks/:id/resume` 🅿 | `paused → running` |
| POST | `/tasks/:id/retry` | `failed → <failedPhase>` |
| POST | `/tasks/:id/cancel` | `{ keepBranch?: boolean }` |
| POST | `/tasks/:id/request-changes` | `{ feedback, reason: 'user' | 'conflict' }`；`review → running` |
| POST | `/tasks/:id/deliver` | `{ strategy, targetBranch?, pr?: { title, body } }`；见 §5.3 |
| GET | `/tasks/:id/diff` | 相对基线（或目标分支 merge-base）的文件列表与增删统计 |
| GET | `/tasks/:id/diff/file?path=` | 单文件 unified diff（超过 `DIFF_FILE_MAX_BYTES` 返回 `{ tooLarge: true }`） |

### 5.1 创建

```ts
type CreateTaskRequest = {
  projectId: string;
  workflowId: string;           // 具体版本 id
  requirement: string;          // 1..REQUIREMENT_MAX_CHARS
  title?: string;
  baseBranch?: string;          // 默认项目 defaultBranch
  checkpoints?: Partial<{ confirm_plan: boolean; accept_each_node: boolean; ask_on_uncertainty: boolean }>;
  start?: boolean;              // 默认 true；false 保存为 draft（专业模式）
};
```

检查点解析：请求值 > 流程 `definition.checkpoints` > 设置 `ai.askOnUncertainty`（仅 ask_on_uncertainty）。解析结果写入 `tasks.checkpoints`，之后不再变。

### 5.2 TaskDetailDTO

```ts
type TaskDetailDTO = {
  id: string; key: string; title: string; requirement: string;
  status: TaskStatus; displayGroup: TaskDisplayGroup; failedPhase?: TaskFailedPhase; failure?: ErrorInfo;
  project: { id: string; name: string };
  workflow: { id: string; key: string; name: string; version: number; deliverable: WorkflowDeliverable };
  checkpoints: Checkpoints;
  git: { baseBranch: string; baseCommit?: string; branch?: string; worktreePath?: string; worktreeStatus?: WorktreeStatus };
  plan?: PlanDTO;                 // 当前生效版本；plan_review 时为待确认草稿
  draftPlan?: PlanDTO;            // 暂停调整中的草稿（专业模式）
  nodes: NodeSummaryDTO[];        // 含 status、roleName、attemptCount、resultSummary、position
  activeAttempts: AttemptSummaryDTO[];
  openInbox: InboxItemDTO[];
  result?: TaskResultDTO;         // review 及之后
  lastDelivery?: DeliveryDTO;
  createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number;
};
```

### 5.3 交付

- `strategy ∈ { squash, merge, rebase }`：本地合并到 `targetBranch`（默认 `baseBranch`），见 09 §7。成功 → 任务 `completed`。冲突 → 任务回 `review`，`lastDelivery.status = conflict`，`conflictFiles` 列出文件；前端提供「交给 AI 解决」（= `request-changes` with `reason: 'conflict'`）。
- `pull_request`：推送分支到远端 → 创建 PR/MR（`targetBranch` 为目标）→ 任务 `completed`，`prUrl` 记录在 delivery。
- `report_only`：仅 `deliverable = report` 的任务可用，直接 `completed`。
- `deliverable = report` 的任务使用其他策略 → 400 `VALIDATION_FAILED`。

## 6. 计划与节点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tasks/:id/plans` | 版本列表（`PlanDTO` 不含 graph） |
| GET | `/tasks/:id/plans/:version` | 某版本完整内容 |
| POST | `/tasks/:id/plan/confirm` | `{ version }`；`plan_review → running`，或暂停调整中确认草稿 |
| POST | `/tasks/:id/plan/replan` | `{ feedback }`；`plan_review → planning`（AI 在原规划会话中按反馈修改） |
| PUT | `/tasks/:id/plan/draft` 🅿 | `{ baseVersion, graph }`；用户编辑产生新草稿版本（`source=user`）。`plan_review` 时任意编辑；`paused` 时只能改动未开始的节点，否则 409 `NODE_NOT_EDITABLE`；`baseVersion` 不是最新版本 → 409 `PLAN_VERSION_CONFLICT`。返回新 `PlanDTO` 或 400 `PLAN_INVALID` |
| GET | `/tasks/:id/nodes/:nodeId` | `NodeDetailDTO`：定义、状态、结果、检查结果、尝试列表、提交 sha、本节点 diff 统计 |
| GET | `/tasks/:id/nodes/:nodeId/diff` | 本节点提交的 diff 文件列表（`commit_sha^..commit_sha`） |
| POST | `/tasks/:id/nodes/:nodeId/accept` | `awaiting_acceptance → done` |
| POST | `/tasks/:id/nodes/:nodeId/reject` | `{ feedback }`；→ `ready` |
| POST | `/tasks/:id/nodes/:nodeId/retry` | `failed → ready`，`{ feedback? }` |
| POST | `/tasks/:id/nodes/:nodeId/skip` 🅿 | |
| GET | `/attempts/:id` | `AttemptDTO` |
| GET | `/attempts/:id/transcript?afterSeq` | `{ entries: TranscriptEntry[], lastSeq, done: boolean }` |
| POST | `/attempts/:id/abort` 🅿 | 中止进行中的尝试（节点按 `attempt_failed` 处理） |

## 7. 需要你处理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/inbox?status=open&taskId&limit&cursor` | 列表；`/inbox/count` 返回 `{ open }` 用于徽标 |
| POST | `/inbox/:id/resolve` | body 为对应 kind 的 `response`（见 10 §inbox_items）；已关闭 409 `INBOX_ITEM_CLOSED` |
| POST | `/inbox/:id/dismiss` | 仅 `failure` / `delivery` 可忽略 |

`resolve` 是各业务动作的统一入口：`question` → 答案发回会话；`permission` → 回复 opencode；`acceptance` → 节点 accept/reject；`plan` → 等同 plan confirm/replan；`failure` → 任务 retry/cancel；`delivery` 不通过 resolve，而是 `deliver` 成功后自动 resolved。

## 8. Git（专业模式）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/git/status` | 当前分支、是否干净、ahead/behind |
| GET | `/projects/:id/git/branches` | 本地与远端分支，标注任务分支 |
| GET | `/projects/:id/git/log?ref&limit&cursor` | 提交列表 |
| GET | `/projects/:id/git/commits/:sha` | 提交详情 + 文件列表 |
| GET | `/projects/:id/git/diff?from&to&path?` | 任意两个 ref 的 diff |
| GET | `/projects/:id/git/tree?ref&path` | 目录浏览 |
| GET | `/projects/:id/git/file?ref&path` | 文件内容 |
| POST | `/projects/:id/git/fetch` | `git fetch --prune` |
| GET | `/projects/:id/worktrees` | 所有 worktree（含非本应用创建的，标注 `managed`），关联任务、分支、脏状态、ahead/behind |
| POST | `/projects/:id/worktrees/prune` | 清理终态任务遗留的 worktree 与 `git worktree prune` |

## 9. 数据库连接（专业模式）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/db-connections` | 列表（不含密码） |
| POST | `/db-connections` | `{ name, type, host, port, database, username, password, tls }` |
| PATCH | `/db-connections/:id` | 可改密码（传 `password` 时） |
| DELETE | `/db-connections/:id` | |
| POST | `/db-connections/:id/test` | `{ ok, serverVersion?, error? }` |
| GET | `/db-connections/:id/schema` | 表与列（只读浏览） |

## 10. MCP 工具清单与操作清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/mcp/tools` 🅿 | 执行 MCP 的工具名、说明、输入 schema（JSON Schema）、允许的尝试类型 |
| GET | `/operations?expose=palette` | 命令面板可用的操作：id、标题 key、风险、最低模式、输入 schema |

## 11. SSE 事件

`GET /api/v1/events`（`Authorization` 通过查询参数 `?token=` 传递，因 EventSource 不支持头；仅本机）。

- 每条：`id: <单调递增>`、`event: <ServerEventType>`、`data: <JSON>`。
- 断线重连带 `Last-Event-ID`；服务端内存保留最近 `SSE_REPLAY_BUFFER` 条，能补则补；补不上发送 `event: resync`，前端使所有查询失效重新拉取。
- 事件只做「失效通知 + 必要增量」，前端以 TanStack Query 缓存为准：收到 `task.updated` 就 `setQueryData` 或 `invalidate` 对应 key。

| ServerEventType | data | 前端处理 |
| --- | --- | --- |
| `task.updated` | `TaskSummaryDTO` | 更新列表与详情缓存 |
| `node.updated` | `{ taskId, node: NodeSummaryDTO }` | 更新详情中的节点 |
| `plan.updated` | `{ taskId, plan: PlanDTO }` | |
| `attempt.updated` | `{ taskId, nodeId?, attempt: AttemptSummaryDTO }` | |
| `attempt.transcript` | `{ attemptId, entries: TranscriptEntry[] }` | 追加到正在查看的会话流 |
| `inbox.updated` | `{ item: InboxItemDTO, openCount }` | 徽标与列表 |
| `delivery.updated` | `{ taskId, delivery: DeliveryDTO }` | |
| `runtime.updated` | `RuntimeDTO` | 运行环境指示 |
| `settings.updated` | `{ keys: SettingKey[] }` | 重新拉设置（主题、模式即时生效） |
| `resync` | `{}` | 全部失效 |

## 12. preload 能力（非 HTTP）

```ts
interface AwBridge {
  apiToken: string;
  selectDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;       // 仅 http(s)
  revealInFinder(path: string): Promise<void>;
  appVersion: string;
}
```

加解密不暴露给 renderer：后端经 utilityProcess 与 main 之间的 `MessagePort` 请求 main 的 safeStorage。
