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
| GET | `/system/runtime` | `RuntimeDTO`：opencode 状态、路径、版本；`ready` 时含地址与启动时间 |
| POST | `/system/runtime/restart` | `ready` 时重启，`stopped` / `crashed` 时启动（活动尝试 → `interrupted`）；返回启动结束后的 `RuntimeDTO`；其他状态 409 `STATE_TRANSITION_INVALID` |
| GET | `/system/runtime/logs?tail=500` 🅿 | opencode 日志末尾若干行 |
| GET | `/system/storage` | 数据目录占用 |
| GET | `/settings` | 全部设置 `Record<SettingKey, value>` |
| PATCH | `/settings` | 部分更新；按 key 的 schema 校验 |

```ts
type RuntimeDTO =
  | { status: 'not_installed'; path?: string; requiredVersion: '1.19.0' }      // path：找到但无法执行时
  | { status: 'version_mismatch' | 'stopped' | 'starting' | 'crashed'; path: string; version: string; requiredVersion: '1.19.0' }
  | { status: 'ready'; path: string; version: string; requiredVersion: '1.19.0'; url: string; startedAt: number };

type EnvironmentDTO = {
  git: { installed: true; version: string } | { installed: false };
  opencode: RuntimeDTO;
  models: { available: Array<{ providerId: string; modelId: string; name: string }>; defaultModel?: string };
  ready: boolean;              // 三项都满足（M1 起模型列表为占位，M2-04 接入后才计入）
};
```

`models` 来自 opencode `/config/providers`，用于引导页判断「是否已登录至少一个模型提供方」。

opencode 检测：设置 `opencode.binaryPath` 非空时只用该路径，否则依次查找 `PATH` 中的 `opencode` 与 `~/.opencode/bin/opencode`；能执行 `--version` 且输出等于 `OPENCODE_VERSION` → `stopped`（M2 起由运行时启动），版本不同 → `version_mismatch`，找不到或无法执行 → `not_installed`。`recheck` 只在 `not_installed` / `version_mismatch` 时重新检测 opencode（运行时状态机 `recheck`），git 每次都重新检测。

## 3. 项目

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects` | `{ items: ProjectDTO[] }`（按添加时间） |
| POST | `/projects` | `{ repoPath, name? }` → 201 `ProjectDetailDTO`；`repoPath` 须为仓库根目录的绝对路径（子目录、非仓库、不存在 → 400 `PROJECT_PATH_NOT_GIT_REPO`），读取默认分支（`origin/HEAD`，否则当前分支；HEAD 游离且无 `origin/HEAD` → 400 `GIT_BASE_BRANCH_NOT_FOUND`），推断检查命令（13 §1） |
| GET | `/projects/:id` | `ProjectDetailDTO`：`ProjectDTO`（含远端绑定摘要 `hosting: { provider, baseUrl, repo, hasToken } \| null`）+ `inferredHosting`；关联数据库（M5）、活动任务数（M3）随对应模块加入 |
| PATCH | `/projects/:id` | `{ name?, defaultBranch?, checkCommand?: string \| null }`；分支不存在 → 400 `GIT_BASE_BRANCH_NOT_FOUND` |
| DELETE | `/projects/:id` | 有非终态任务时 409 `PROJECT_HAS_ACTIVE_TASKS` |
| PUT | `/projects/:id/hosting` | `{ provider, baseUrl?, repo, token }`（`token` 为凭据字段）→ `ProjectDetailDTO`；保存前调用平台 API 读取该仓库验证令牌（令牌无效或看不到仓库 401 `HOSTING_AUTH_FAILED`，其他失败 502 `HOSTING_API_ERROR`），通过后加密保存（再次绑定替换原令牌）。GitHub 忽略 `baseUrl`；GitLab 不填即 gitlab.com |
| DELETE | `/projects/:id/hosting` | 解除绑定并删除凭据 → `ProjectDetailDTO`；删除项目时同样删除其凭据 |
| PUT | `/projects/:id/db-connections` 🅿 | `{ connectionIds: string[] }` 覆盖关联 |

远端 `repo` 默认从 `git remote get-url origin` 推断（`inferredHosting`：`github.com` → GitHub，其他主机 → GitLab，非 `gitlab.com` 时 `baseUrl = https://<host>`），前端预填。

## 4. 流程与角色

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/workflows` | 最新版本列表（按流程首次加入的顺序；内置流程在前） |
| GET | `/workflows/:id` | 某版本详情（含 `definition`） |
| GET | `/workflows/by-key/:key/versions` 🅿 | 版本历史 |
| POST | `/workflows` 🅿 | 新建自定义流程 `{ key, name, description, planning, deliverable, definition }`；或 `{ copyFrom: workflowId, key, name }` |
| PUT | `/workflows/:id` 🅿 | `{ name?, description?, definition? }`；产生新版本，返回新版本；内置流程 409 `WORKFLOW_READONLY` |
| DELETE | `/workflows/by-key/:key` 🅿 | 仅自定义；已被任务引用的版本保留（标记删除，不在列表出现） |
| POST | `/workflows/validate` 🅿 | 校验定义，返回 `{ problems[] }`（编辑器实时校验用） |
| GET | `/roles` | 列表 |
| POST | `/roles` 🅿 | 新建或 `{ copyFrom }` |
| PUT | `/roles/:id` 🅿 | `{ name?, description?, prompt?, model? }`；内置 409 `ROLE_READONLY` |
| DELETE | `/roles/:id` 🅿 | 被最新版流程引用时 409 `ROLE_IN_USE` |

## 5. 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tasks?projectId&status&displayGroup&limit` | `{ items: TaskSummaryDTO[] }`，按 `updatedAt` 倒序，最多 `limit`（默认 50，≤ 100）条；v1 不分页 |
| POST | `/tasks` | 创建，见下 |
| GET | `/tasks/:id` | `TaskDetailDTO` |
| GET | `/tasks/:id/timeline?afterId` | `{ items: TaskEventDTO[] }`：`id > afterId` 的 `task_events`，按 id 升序 |
| POST | `/tasks/:id/start` | `draft → preparing` |
| POST | `/tasks/:id/pause` 🅿 | `running → paused` |
| POST | `/tasks/:id/resume` 🅿 | `paused → running` |
| POST | `/tasks/:id/retry` | `failed → <failedPhase>` |
| POST | `/tasks/:id/cancel` | `{ keepBranch?: boolean }` |
| POST | `/tasks/:id/request-changes` | `{ reason: 'user' \| 'conflict', feedback? }`；`review → running`，追加「按反馈修改」或「解决合并冲突」节点（13 §4）。`user` 必须带 `feedback`；`conflict` 要求最近一次交付为 `conflict`；否则 400 `VALIDATION_FAILED` |
| POST | `/tasks/:id/deliver` | `{ strategy, targetBranch?, pr?: { title, body } }`；见 §5.3 |
| GET | `/tasks/:id/diff` | `DiffDTO { base, files }`：worktree（含未提交改动）相对任务分支与目标分支的 merge-base（起初即基线提交；解决冲突合入目标分支后为目标分支的提交）的文件列表与增删统计；worktree 已删除 → 404 `NOT_FOUND` |
| GET | `/tasks/:id/diff/file?path=` | 单文件 unified diff `FileDiffDTO`（超过 `DIFF_FILE_MAX_BYTES` 返回 `{ tooLarge: true, size }`） |

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

TaskSummaryDTO：`{ id, key, title, status, displayGroup, project: { id, name }, workflow: { id, key, name }, currentStep, progress, createdAt, updatedAt, startedAt, finishedAt }`（`currentStep` 为工作中的步骤标题，`progress` 为活动尝试最近一次 `report_progress`）。DTO 中可空字段用 `null` 表示（下式中的 `?`）。

```ts
type TaskDetailDTO = {
  id: string; key: string; title: string; requirement: string;
  status: TaskStatus; displayGroup: TaskDisplayGroup; failedPhase?: TaskFailedPhase; failure?: ErrorInfo;
  project: { id: string; name: string };
  workflow: { id: string; key: string; name: string; version: number; deliverable: WorkflowDeliverable };
  checkpoints: Checkpoints;
  git: { baseBranch: string; baseCommit?: string; branch?: string; worktreePath?: string; worktreeStatus?: WorktreeStatus };
  plan?: PlanDTO;                 // 当前生效版本；plan_review 时为待确认草稿
  draftPlan?: PlanDTO;            // 暂停调整中的草稿（专业模式，M5-02）
  nodes: NodeSummaryDTO[];        // 含 status、roleName、attemptCount、resultSummary、position
  activeAttempts: AttemptSummaryDTO[];
  openInbox: InboxItemDTO[];
  result?: TaskResultDTO;         // review 及之后
  lastDelivery?: DeliveryDTO;     // 最近一次交付：{ id, strategy, targetBranch, status, commitSha?, prUrl?, conflictFiles?, error?, createdAt, finishedAt? }
  createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number;
};
```

### 5.3 交付

- `strategy ∈ { squash, merge, rebase }`：本地合并到 `targetBranch`（默认 `baseBranch`），见 09 §7。合并前的检查失败直接返回错误、不改状态：`DELIVERY_TARGET_NOT_FOUND`、`WORKTREE_DIRTY`、`DELIVERY_TARGET_DIRTY`（目标分支检出在有未提交改动的工作区）。成功 → 任务 `completed`。冲突 → 任务回 `review`，`lastDelivery.status = conflict`，`conflictFiles` 列出文件；前端提供「交给 AI 解决」（= `request-changes` with `reason: 'conflict'`）。其他 git 失败 → 任务回 `review`，`lastDelivery.status = failed`，`error` 为原因。以上都返回操作后的 `TaskDetailDTO`。
- `pull_request`：项目未绑定远端 → 400 `HOSTING_NOT_CONFIGURED`（不改状态）。在仓库锁内把任务分支推送到 `origin`（HTTPS 远端经环境变量 `http.extraHeader` 带上令牌，不出现在命令参数中；SSH 远端用用户自己的密钥）→ 创建 PR/MR（`targetBranch` 为目标，标题与说明默认为任务标题与结果摘要，可用 `pr` 指定）→ 任务 `completed`，`prUrl` 记录在 delivery；worktree 删除，分支保留。推送或平台失败 → `lastDelivery.status = failed`，任务回 `review`。
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
| GET | `/tasks/:id/nodes/:nodeId/diff` | 本节点提交的 diff 文件列表 `DiffDTO`（`commit_sha^..commit_sha`，在项目仓库中读取，worktree 删除后仍可用）；没有提交的节点 `{ base: null, files: [] }` |
| GET | `/tasks/:id/nodes/:nodeId/diff/file?path=` | 本节点提交中单文件的 unified diff `FileDiffDTO`；没有提交 → 404 `NOT_FOUND` |
| POST | `/tasks/:id/nodes/:nodeId/accept` | `awaiting_acceptance → done` |
| POST | `/tasks/:id/nodes/:nodeId/reject` | `{ feedback }`；→ `ready` |
| POST | `/tasks/:id/nodes/:nodeId/retry` | `failed → ready`，`{ feedback? }` |
| POST | `/tasks/:id/nodes/:nodeId/skip` 🅿 | |
| GET | `/attempts/:id` | `AttemptDTO`；不存在 404 `ATTEMPT_NOT_FOUND` |
| GET | `/attempts/:id/transcript?afterSeq` | `{ entries: TranscriptEntry[], lastSeq, done: boolean }`（非清单路由，10 §3）：`lastSeq` 为本页最大 seq（空页为请求的 `afterSeq`），`done` 表示尝试已结束且已读到末尾 |
| POST | `/attempts/:id/abort` 🅿 | 中止进行中的尝试（节点按 `attempt_failed` 处理）；非 `running` 409 `STATE_TRANSITION_INVALID` |
| POST | `/debug/attempts` | 仅开发构建（M2-09）：`{ directory, requirement, model? }` → 201 `AttemptDTO`；对 Git 目录发起一次不属于任务的 `execute` 尝试。目录不在 Git 仓库中 400 `PROJECT_PATH_NOT_GIT_REPO`；opencode 未就绪 503 `OPENCODE_NOT_READY` |

```ts
type AttemptSummaryDTO = {
  id: string; taskId: string | null; nodeId: string | null;   // 调试尝试两者皆空
  kind: AttemptKind; seq: number; status: AttemptStatus;
  model: string | null; nudges: number; error: ErrorInfo | null;
  progress: string | null;          // 最近一次 report_progress，仅活动期间，内存中
  startedAt: number; endedAt: number | null;
};
type AttemptDTO = AttemptSummaryDTO & {
  directory: string; opencodeSessionId: string | null;
  tokensInput: number | null; tokensOutput: number | null; cost: number | null;
};
```

## 7. 需要你处理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/inbox?status&taskId` | `{ items: InboxItemDTO[] }`，按创建时间倒序；`/inbox/count` 返回 `{ open }` 用于徽标 |
| POST | `/inbox/:id/resolve` | `{ response }`，`response` 为对应 kind 的回应（见 10 §inbox_items；`question` 只接受 `{ answer }`）；不符合该 kind 400 `VALIDATION_FAILED`；已关闭 409 `INBOX_ITEM_CLOSED`；回答问题时 opencode 未就绪 503 `OPENCODE_NOT_READY`（条目保持打开） |
| POST | `/inbox/:id/dismiss` | 仅 `failure` / `delivery` 可忽略 |

`resolve` 是各业务动作的统一入口：`question` → 答案发回会话；`permission` → 回复 opencode；`acceptance` → 节点 accept/reject；`plan` → 等同 plan confirm/replan；`failure` → 任务 retry/cancel；`delivery` 不通过 resolve，而是 `deliver` 成功后自动 resolved。

## 8. Git（专业模式）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/git/status` | 主工作区：当前分支、提交、上游与 ahead/behind、是否干净、改动文件（porcelain 两字母代码） |
| GET | `/projects/:id/git/branches` | 本地与远端分支（不含 `origin/HEAD` 这类符号引用），标注当前分支与所属任务（`task: { id, key, status }`） |
| GET | `/projects/:id/git/log?ref&limit&cursor` | 提交列表 `{ items, nextCursor }`，`cursor` 为已显示的提交数 |
| GET | `/projects/:id/git/commits/:sha` | 提交详情 + 相对第一个父提交的文件列表（根提交与空树比较） |
| GET | `/projects/:id/git/diff?from&to` | 任意两个 ref 的文件列表 `DiffDTO` |
| GET | `/projects/:id/git/diff/file?from&to&path` | 单文件 unified diff（`FileDiffDTO`，超过 `DIFF_FILE_MAX_BYTES` 只返回大小） |
| GET | `/projects/:id/git/tree?ref&path` | 目录浏览（目录在前；`path` 为空即仓库根） |
| GET | `/projects/:id/git/file?ref&path` | 文件内容；二进制返回 `{ binary: true }`，超过 `DIFF_FILE_MAX_BYTES` 返回 `{ tooLarge: true, size }` |
| POST | `/projects/:id/git/fetch` | `git fetch --all --prune`（仓库锁内） |
| GET | `/projects/:id/worktrees` | 所有 worktree（含非本应用创建的，标注 `managed`），关联任务、分支、脏状态、相对项目默认分支的 ahead/behind；目录已不存在的标 `prunable` |
| POST | `/projects/:id/worktrees/prune` | 删除终态任务遗留的 worktree（保留分支）并 `git worktree prune`，返回新的列表 |

不存在的 ref 或路径返回 404 `NOT_FOUND`（`details.object`）。

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
| GET | `/operations?expose=palette` | `{ items: OperationInfo[] }`：命令面板可用的操作（`expose.palette` 且非 critical）：id、标题 key、说明、风险、最低模式、method、path、输入 JSON Schema；不带 `expose` 返回全部 |

## 11. SSE 事件

`GET /api/v1/events`（`Authorization` 通过查询参数 `?token=` 传递，因 EventSource 不支持头；仅本机）。

- 每条：`id: <bootId>-<seq>`（`bootId` 每次后端启动随机生成，`seq` 单调递增）、`event: <ServerEventType>`、`data: <JSON>`。
- 断线重连带 `Last-Event-ID`；服务端内存保留最近 `SSE_REPLAY_BUFFER` 条，能补则补；补不上（超出缓冲、或 `bootId` 不是本次启动）发送 `event: resync`（其 id 为当前位置），前端使所有查询失效重新拉取。
- 事件 schema 为 `shared/contracts/events` 的 `serverEventSchema`；各里程碑随实体加入对应事件。
- 事件只做「失效通知 + 必要增量」，前端以 TanStack Query 缓存为准：收到 `task.updated` 就 `setQueryData` 或 `invalidate` 对应 key。

| ServerEventType | data | 前端处理 |
| --- | --- | --- |
| `task.updated` | `TaskSummaryDTO` | 更新列表与详情缓存 |
| `node.updated` | `{ taskId, node: NodeSummaryDTO }` | 更新详情中的节点 |
| `plan.updated` | `{ taskId, plan: PlanDTO }` | |
| `attempt.updated` | `{ taskId, nodeId, attempt: AttemptSummaryDTO }`（调试尝试 `taskId`、`nodeId` 为 null） | 状态、提醒次数、当前进展变化时 |
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
