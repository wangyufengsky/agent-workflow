# 11 · 后端 REST API 与 SSE 事件

## 1. 约定

- 基址：相对路径 `/api/v1`。前端页面由后端同源托管（开发时 Vite 代理到 `DEV_API_PORT`，D31）；令牌由 preload 提供（`window.aw.apiToken`），浏览器开发/E2E 模式用 `VITE_AW_API_TOKEN`。
- 认证：`Authorization: Bearer <apiToken>`；缺失或错误 → 401 `UNAUTHORIZED`。
- 请求与响应均为 JSON，字段 `camelCase`；枚举值为 `snake_case` 字符串；时间为毫秒时间戳。
- 除 SSE、会话流、diff 文件内容等少数流式接口外，端点都由**操作清单**挂载（[03 §5](03-architecture.md#5-操作清单operation-registry)）：每个端点对应一个操作 id，schema 位于 `shared/operations/<domain>.ts`，路由、前端客户端、命令面板、v1.1 助手共用，**本文与清单不一致以清单为准并修正本文**。
- 成功：`200` 返回资源或 `{ items, nextCursor }`；创建返回 `201`；无内容返回 `204`。
- 失败：`{ "error": { "code", "message", "details"? } }`，状态码见 [08 §5](08-enums-and-errors.md#5-错误码)。
- 命令型操作（start / cancel / deliver…）用 `POST /资源/:id/<动词>`，返回操作后的完整资源 DTO，前端直接用它更新缓存。
- 分页：`?limit=<1..LIST_PAGE_MAX，默认 LIST_PAGE_DEFAULT>&cursor=<不透明字符串>`，响应 `{ items, nextCursor }`（`nextCursor` 为空即最后一页）；任务与「需要你处理」列表用上一页最后一项的排序键做游标（keyset），列表在两页之间变化时不重复也不跳过未变的项。
- 不做幂等键与回执：本地同步事务，重复点击由状态机拒绝（`STATE_TRANSITION_INVALID`），前端按钮在请求期间禁用。

标记：🅿 = 仅专业模式界面使用（API 本身不区分模式）。

## 2. 系统与设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/system/health` | `{ status: 'ok', appVersion, node }`：后台存活、应用版本（`AW_APP_VERSION`，桌面包的版本号）与 Node.js 版本；「设置 → 关于」显示 |
| GET | `/system/environment` | 环境检测结果 `EnvironmentDTO` |
| POST | `/system/environment/recheck` | 重新检测（安装 opencode 后用） |
| GET | `/system/runtime` | `RuntimeDTO`：opencode 状态、路径、版本；`ready` 时含地址与启动时间 |
| POST | `/system/runtime/restart` | `ready` 时重启，`stopped` / `crashed` 时启动（活动尝试 → `interrupted`）；返回启动结束后的 `RuntimeDTO`；其他状态 409 `STATE_TRANSITION_INVALID` |
| GET | `/system/runtime/logs?tail=500` 🅿 | 最新一天 opencode 日志（`<数据目录>/logs/opencode-YYYYMMDD.log`）的末尾 `tail` 行（默认 `RUNTIME_LOG_TAIL_DEFAULT`，至多 `RUNTIME_LOG_TAIL_MAX`）：`{ file, lines }`；还没有日志时 `{ file: null, lines: [] }` |
| GET | `/settings` | 全部设置 `Record<SettingKey, value>` |
| PATCH | `/settings` | 部分更新；按 key 的 schema 校验 |

```ts
type RuntimeDTO =
  | { status: 'not_installed'; path?: string; requiredVersion: '1.19.0' }      // path：找到但无法执行时
  | { status: 'version_mismatch' | 'stopped' | 'starting' | 'crashed'; path: string; version: string; requiredVersion: '1.19.0' }
  | { status: 'ready'; path: string; version: string; requiredVersion: '1.19.0'; url: string; startedAt: number };

type EnvironmentDTO = {
  platform: 'darwin' | 'win32' | 'linux';   // 后端的操作系统，引导页据此显示安装命令（D75）
  git: { installed: true; version: string } | { installed: false };   // Windows 上还要求 Git for Windows 的 Git Bash（D72）
  opencode: RuntimeDTO;
  models: { available: Array<{ providerId: string; modelId: string; name: string }>; defaultModel?: string };
  credentials: { available: boolean };   // 能否保存令牌与密码（safeStorage；Linux 无密钥服务时为 false，D74），不计入 ready
  ready: boolean;              // git、opencode、模型三项都满足
};
```

`models` 来自 opencode `/config/providers`，用于引导页判断「是否已登录至少一个模型提供方」。

opencode 检测：设置 `opencode.binaryPath` 非空时只用该路径，否则依次查找 `PATH` 中的 `opencode` 与主目录下的 `.opencode/bin/opencode`（Windows：`opencode.exe` 或 npm 的 `opencode.cmd`，主目录为 `%USERPROFILE%`，17 §3.2）；能执行 `--version` 且输出等于 `OPENCODE_VERSION` → `stopped`（M2 起由运行时启动），版本不同 → `version_mismatch`，找不到或无法执行 → `not_installed`。`recheck` 只在 `not_installed` / `version_mismatch` 时重新检测 opencode（运行时状态机 `recheck`），git 每次都重新检测；之后启动 `stopped` 或 `crashed` 的运行时（`crashed` 可能是环境问题已修好，如 Windows 上补装了 Git Bash，D72），并重新允许一次自动重启。

## 3. 项目

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects` | `{ items: ProjectDTO[] }`（按添加时间） |
| POST | `/projects` | `{ repoPath, name? }` → 201 `ProjectDetailDTO`；`repoPath` 须为仓库根目录的绝对路径（子目录、非仓库、不存在 → 400 `PROJECT_PATH_NOT_GIT_REPO`），读取默认分支（`origin/HEAD`，否则当前分支；HEAD 游离且无 `origin/HEAD` → 400 `GIT_BASE_BRANCH_NOT_FOUND`），推断检查命令（13 §1） |
| GET | `/projects/:id` | `ProjectDetailDTO`：`ProjectDTO`（含远端绑定摘要 `hosting: { provider, baseUrl, repo, hasToken } \| null`）+ `inferredHosting` + 关联的数据库连接 `dbConnectionIds`（M5-07）+ 总是允许的 bash 模式 `allowedBash: string[]`（按记下的时间，D101） |
| PATCH | `/projects/:id` | `{ name?, defaultBranch?, checkCommand?: string \| null, preview?: ProjectPreview \| null }`；分支不存在 → 400 `GIT_BASE_BRANCH_NOT_FOUND`；`preview` 为页面预览设置（29 §4.1：`command`、`setupCommand`、`readyPath`、`pages`、`extraOrigins`），`extraOrigins` 每项须为来源（`http(s)://主机[:端口]`），否则 400 |
| DELETE | `/projects/:id` | 有非终态任务时 409 `PROJECT_HAS_ACTIVE_TASKS` |
| PUT | `/projects/:id/hosting` | `{ provider, baseUrl?, repo, token }`（`token` 为凭据字段）→ `ProjectDetailDTO`；保存前调用平台 API 读取该仓库验证令牌（令牌无效或看不到仓库 401 `HOSTING_AUTH_FAILED`，其他失败 502 `HOSTING_API_ERROR`），通过后加密保存（再次绑定替换原令牌）。GitHub 忽略 `baseUrl`；GitLab 不填即 gitlab.com |
| DELETE | `/projects/:id/hosting` | 解除绑定并删除凭据 → `ProjectDetailDTO`；删除项目时同样删除其凭据 |
| DELETE | `/projects/:id/allowed-bash` 🅿 | `?pattern=` 撤销一条总是允许的 bash 模式 → `ProjectDetailDTO`；不存在的模式不报错。之后新建的会话重新询问，运行中的会话不变（D101）。模式只由「需要你处理」中权限条目的「总是允许」添加（§7），没有添加接口 |
| PUT | `/projects/:id/db-connections` 🅿 | `{ connectionIds: string[] }` 覆盖关联 → `ProjectDetailDTO`；不存在的连接 404 `DB_CONNECTION_NOT_FOUND`。项目的 AI 会话只能用关联的连接（12 §6.9） |

`ProjectDTO.preview` 为页面预览设置，添加项目时按 `package.json` 推断（29 §4.1），没有可推断的脚本时为 null。

远端 `repo` 默认从 `git remote get-url origin` 推断（`inferredHosting`：`github.com` → GitHub，其他主机 → GitLab，非 `gitlab.com` 时 `baseUrl = https://<host>`），前端预填。

## 4. 流程与角色

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/workflows` | 最新版本列表（按流程首次加入的顺序；内置流程在前） |
| GET | `/workflows/:id` | 某版本详情（含 `definition`） |
| GET | `/workflows/by-key/:key/versions` 🅿 | 版本历史（新的在前，含已删除流程被任务保留的版本）；没有该 key 404 `WORKFLOW_NOT_FOUND` |
| POST | `/workflows` 🅿 | 新建自定义流程 `{ key, name, description?, planning, deliverable, definition }`；或 `{ copyFrom: workflowId, key, name, description? }`（可复制内置流程）→ 201 `WorkflowDTO`（`kind=custom`）。`key` 为 `DEFINITION_KEY_PATTERN`（`[a-z][a-z0-9_]{0,39}`），已被列出的流程使用 409 `WORKFLOW_ALREADY_EXISTS`；定义按 08 §5.4 校验，失败 400 `WORKFLOW_DEFINITION_INVALID`。版本号接在该 key 已有版本之后 |
| PUT | `/workflows/:id` 🅿 | `{ name?, description?, definition? }`；校验后产生新版本，返回新版本；运行中的任务继续用旧版本；内置流程 409 `WORKFLOW_READONLY` |
| DELETE | `/workflows/by-key/:key` 🅿 | 仅自定义（内置 409 `WORKFLOW_READONLY`）→ 204；已被任务引用的版本保留但不再列出（`is_latest` 全部置否），其余版本删除 |
| POST | `/workflows/validate` 🅿 | `{ planning, definition }` → `{ problems[] }`（08 §5.4；编辑器保存前校验） |
| GET | `/roles` | 列表 |
| POST | `/roles` 🅿 | 新建 `{ key, name, description?, baseAgent, prompt, model? }` 或复制 `{ copyFrom: roleId, key, name, ... }`（可复制内置角色）→ 201 `RoleDTO`；key 已存在 409 `ROLE_ALREADY_EXISTS` |
| PUT | `/roles/:id` 🅿 | `{ name?, description?, prompt?, model? }`；内置 409 `ROLE_READONLY` |
| DELETE | `/roles/:id` 🅿 | 内置 409 `ROLE_READONLY`；被列出的流程（最新版本的允许角色、规划者、必经步骤、模板）引用，或被任务的步骤与会话使用过 → 409 `ROLE_IN_USE`；成功 204 |

删除流程与角色需要知道任务的使用情况，由 tasks 模块实现（同删除项目）。

## 5. 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tasks?projectId&status&displayGroup&limit&cursor` | `{ items: TaskSummaryDTO[], nextCursor }`，按 `updatedAt`（同时按编号）倒序分页（§1，`LIST_PAGE_DEFAULT` / `LIST_PAGE_MAX`）；`displayGroup` 在查询中过滤（由 `resolveTaskDisplayGroup` 推出每个状态与是否有打开的提问 / 权限 / 验收条目的组合），每页都是满的；游标为上一页最后一个任务的 `<updatedAt>.<seq>`，格式不对 400 `VALIDATION_FAILED` |
| POST | `/tasks` | 创建，见下 |
| GET | `/tasks/:id` | `TaskDetailDTO` |
| GET | `/tasks/:id/preview/sessions` | `{ attempts: [{ attemptId, nodeId, kind, status, frames }], checks: [{ nodeId, passed }] }`：任务预览页签可看的会话（v1.3 B2，29 §8.1）——留下过动作画面的尝试，与最近一次页面体检有截图的步骤 |
| GET | `/tasks/:id/timeline?afterId` | `{ items: TaskEventDTO[] }`：`id > afterId` 的 `task_events`，按 id 升序 |
| POST | `/tasks/:id/start` | `draft → preparing` |
| POST | `/tasks/:id/pause` 🅿 | `running → paused`：不再派发新步骤，进行中的步骤继续 |
| POST | `/tasks/:id/resume` 🅿 | `paused → running`；未确认的调整草稿被取代 |
| POST | `/tasks/:id/retry` | `{ feedback? }`：`failed → <failedPhase>`；`feedback`（D118）作为重试的失败步骤下一次尝试的说明（同 `nodes/:nodeId/retry`），其他阶段的失败忽略它；检查命令无法运行而失败的步骤 `recheck`（用已提交的结果重新检查，不重跑 AI，D116），其余失败步骤 `retry` |
| POST | `/tasks/:id/check-command` | `{ command, updateProject }`（D116）：只限在执行阶段因命令检查失败的任务（`CHECK_COMMAND_UNRUNNABLE`，或 `NODE_ATTEMPTS_EXHAUSTED` 且最近一次已提交的结果未通过命令检查），否则 409 `STATE_TRANSITION_INVALID`；任务未完成的步骤（`pending` / `ready` / `failed`）中与失败命令相同的命令检查换成 `command`，`updateProject` 时同时设为项目的检查命令；然后重试：已提交结果的失败步骤 `recheck`（预算重置），其余 `retry` |
| POST | `/tasks/:id/skip-check` | （D116）只限因 `CHECK_COMMAND_UNRUNNABLE` 或 `BROWSER_CHECK_UNRUNNABLE` 失败的任务，否则 409 `STATE_TRANSITION_INVALID`；未完成步骤中这条命令检查（或所有页面体检）标 `skipped`，然后重试（失败步骤 `recheck`）；结果卡与 PR 说明写明未验证 |
| POST | `/tasks/:id/cancel` | `{ keepBranch?: boolean }` |
| POST | `/tasks/:id/request-changes` | `{ reason: 'user' \| 'conflict', feedback?, page?: { tabId } }`（`page`：用户预览标签页的当前页面随意见交给 AI，后端自己读取路径、视口、控制台错误与失败请求，29 §2.3；v1.3 B2，助手不能设置）；`review → running`，追加「按反馈修改」或「解决合并冲突」节点（13 §4）。`user` 必须带 `feedback`；`conflict` 要求最近一次交付为 `conflict`；否则 400 `VALIDATION_FAILED` |
| POST | `/tasks/:id/deliver` | `{ strategy, targetBranch?, pr?: { title, body } }`；见 §5.3 |
| GET | `/tasks/:id/review-comments` | `ReviewCommentsDTO`：任务的 PR/MR 上的审查意见，实时取自平台；见 §5.4 |
| POST | `/tasks/:id/review-feedback` | `{ commentIds: string[], note? }`；`completed → running`，按勾选的审查意见追加「按审查意见修改」节点；见 §5.4 |
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
  lastDelivery?: DeliveryDTO;     // 本轮（最近一次进入 review 以来）最近的交付；「再改改」/「解决冲突」后回到 review 即为空：{ id, strategy, targetBranch, status, commitSha?, prUrl?, conflictFiles?, error?, createdAt, finishedAt? }
  pullRequest?: { url: string; pushedAt: number };  // 最近一次成功的 PR 交付（跨轮次；pushedAt 为其完成时间，21 §5）
  createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number;
};
```

### 5.3 交付

- `strategy ∈ { squash, merge, rebase }`：本地合并到 `targetBranch`（默认 `baseBranch`），见 09 §7。合并前的检查失败直接返回错误、不改状态：`DELIVERY_TARGET_NOT_FOUND`、`WORKTREE_DIRTY`、`DELIVERY_TARGET_DIRTY`（目标分支检出在有未提交改动的工作区）。成功 → 任务 `completed`。冲突 → 任务回 `review`，`lastDelivery.status = conflict`，`conflictFiles` 列出文件；前端提供「交给 AI 解决」（= `request-changes` with `reason: 'conflict'`）。其他 git 失败 → 任务回 `review`，`lastDelivery.status = failed`，`error` 为原因。以上都返回操作后的 `TaskDetailDTO`。
- `pull_request`：项目未绑定远端 → 400 `HOSTING_NOT_CONFIGURED`（不改状态）。在仓库锁内把任务分支推送到 `origin`（HTTPS 远端经环境变量 `http.extraHeader` 带上令牌，不出现在命令参数中；SSH 远端用用户自己的密钥）→ 创建 PR/MR（`targetBranch` 为目标，标题与说明默认为任务标题与结果摘要，可用 `pr` 指定）→ 任务 `completed`，`prUrl` 记录在 delivery；worktree 删除，分支保留。推送或平台失败 → `lastDelivery.status = failed`，任务回 `review`。推送后先按分支查找打开的 PR/MR：已有（按审查意见修改后再次交付）就沿用它、不改标题与说明，`prUrl` 为同一个地址（21 §5）。
- `report_only`：仅 `deliverable = report` 的任务可用，直接 `completed`。
- `deliverable = report` 的任务使用其他策略 → 400 `VALIDATION_FAILED`。

### 5.4 PR 审查意见（v1.2，21）

- `GET /tasks/:id/review-comments`（`tasks.reviewComments`，read）：任务的最近一次成功交付必须是 PR，且该分支上的 PR/MR 仍打开，否则 409 `PULL_REQUEST_NOT_OPEN`；项目未绑定远端 400 `HOSTING_NOT_CONFIGURED`；平台错误 `HOSTING_AUTH_FAILED` / `HOSTING_API_ERROR`。返回：

```ts
type ReviewCommentsDTO = {
  pullRequest: { url: string; number: number };
  items: Array<{
    id: string;                      // 平台上的讨论 / 评论 / 审查 id
    kind: ReviewCommentKind;         // thread | general
    path?: string; line?: number;    // thread 所在的文件与行
    url: string;
    messages: Array<{ author: string; body: string; createdAt: number }>;  // 按时间
    selectedByDefault: boolean;      // 未解决的讨论；上次推送之后的一般评论（D87）
  }>;
};
```

  已解决的讨论、系统笔记与空正文不列出；每类最多 100 条（`REVIEW_COMMENTS_MAX`）。
- `POST /tasks/:id/review-feedback`（`tasks.reviseFromReview`，write）：`{ commentIds: string[]（至少一条）, note?: string }`。顺序：状态机检查 `completed --review_feedback--> running`（否则 409 `STATE_TRANSITION_INVALID`）→ 同上检查 PR → 重新取回意见，`commentIds` 有不在其中的 → 400 `VALIDATION_FAILED`（`issues[].path = ['commentIds']`）→ 抓取远端分支并快进本地任务分支（两边分叉 409 `BRANCH_DIVERGED`，不做改动）→ 重建 worktree（失败 `WORKTREE_CREATE_FAILED`）→ 一个事务内建计划新版本、追加 `review_fix_<n>` 节点、任务 `running`。返回 `TaskDetailDTO`。完成后任务回到 `review`，用户以 `deliver`（`pull_request`）推送回同一个 PR。

## 6. 计划与节点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tasks/:id/plans` | 版本列表（`PlanDTO` 不含 graph） |
| GET | `/tasks/:id/plans/:version` | 某版本完整内容 |
| POST | `/tasks/:id/plan/confirm` | `{ version }`；`plan_review → running`，或暂停调整中确认草稿（重新物化，见 09 §2；任务保持 `paused`，已开始的节点期间被改动 409 `NODE_NOT_EDITABLE`）。`version` 不是当前草稿 → 409 `PLAN_VERSION_CONFLICT` |
| POST | `/tasks/:id/plan/replan` | `{ feedback }`；`plan_review → planning`（AI 在原规划会话中按反馈修改） |
| PUT | `/tasks/:id/plan/draft` 🅿 | `{ baseVersion, graph }`；用户编辑产生新草稿版本（`source=user`，沿用基础版本的说明与假设，取代原草稿）。`plan_review` 时任意编辑（「需要你处理」中的确认确认的是当前草稿）；`paused` 时只能改动、删除未开始的节点（`details.nodes` 列出被改动的已开始节点），否则 409 `NODE_NOT_EDITABLE`；`baseVersion` 不是最新版本 → 409 `PLAN_VERSION_CONFLICT`；其他状态 409 `STATE_TRANSITION_INVALID`。校验与计划画布相同：`validatePlanGraph(graph, planEditRules(definition, base))`（允许角色另含计划中已有的角色，如系统节点的 developer），失败 400 `PLAN_INVALID`。返回新 `PlanDTO` |
| GET | `/tasks/:id/nodes/:nodeId` | `NodeDetailDTO`：定义、状态、结果、检查结果、尝试列表、提交 sha、本节点 diff 统计 |
| GET | `/tasks/:id/nodes/:nodeId/diff` | 本节点提交的 diff 文件列表 `DiffDTO`（`commit_sha^..commit_sha`，在项目仓库中读取，worktree 删除后仍可用）；没有提交的节点 `{ base: null, files: [] }` |
| GET | `/tasks/:id/nodes/:nodeId/diff/file?path=` | 本节点提交中单文件的 unified diff `FileDiffDTO`；没有提交 → 404 `NOT_FOUND` |
| POST | `/tasks/:id/nodes/:nodeId/accept` | `awaiting_acceptance → done` |
| POST | `/tasks/:id/nodes/:nodeId/reject` | `{ feedback }`；→ `ready` |
| POST | `/tasks/:id/nodes/:nodeId/retry` | `failed → ready`，`{ feedback? }` |
| POST | `/tasks/:id/nodes/:nodeId/skip` 🅿 | `pending` / `ready` / `failed` → `skipped`，返回 `NodeDetailDTO`；其他状态 409 `STATE_TRANSITION_INVALID` |
| GET | `/attempts/:id` | `AttemptDTO`；不存在 404 `ATTEMPT_NOT_FOUND` |
| GET | `/attempts/:attemptId/browser/:file` | 尝试的截图（`<n>.jpg`）与动作画面（`f<n>.jpg`）（非清单路由，29 §5.7）：目录由尝试解析（会话流所在目录下的 `browser/<attemptId>/`），没有任务的尝试也能取到；文件名只接受这两种格式，其余 404 `NOT_FOUND`，尝试不存在 404 `ATTEMPT_NOT_FOUND`；`image/jpeg` |
| GET | `/tasks/:taskId/browser/*` | 页面体检的截图（非清单路由，29 §5.7）：`*` 为检查结果里 `screenshot` 的相对路径（`checks/<nodeId>/<检查时刻>/<n>.jpg`），只读 `runs/<taskId>/browser/` 下的 `.jpg`，其余 404 `NOT_FOUND`；`image/jpeg` |
| GET | `/attempts/:id/transcript?afterSeq` | `{ entries: TranscriptEntry[], lastSeq, hasMore: boolean, done: boolean }`（非清单路由，10 §3）：`lastSeq` 为本页最大 seq（空页为请求的 `afterSeq`），`hasMore` 表示本页之后已有写入的行（以 `afterSeq = lastSeq` 继续读），`done` 表示尝试已结束且已读到末尾 |
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
| GET | `/inbox?status&taskId&blocking&limit&cursor` | `{ items: InboxItemDTO[], nextCursor }`，按创建时间（同时按 id）倒序分页（§1）；`blocking=true` 只列 `BLOCKING_INBOX_KINDS`，`false` 只列其余（待合并），不传列全部（D119：两组在服务端筛选，各自分页，一页待合并不会挡住更早的卡住任务的条目）；`/inbox/count` 返回 `{ blocking }` 用于徽标：打开且属于 `BLOCKING_INBOX_KINDS`（除 `delivery` 外的所有种类）的条目数（D119） |
| POST | `/inbox/:id/resolve` | `{ response }`，`response` 为对应 kind 的回应（见 10 §inbox_items；`question` 只接受 `{ answer }`）；不符合该 kind 400 `VALIDATION_FAILED`；已关闭 409 `INBOX_ITEM_CLOSED`；回答问题时 opencode 未就绪 503 `OPENCODE_NOT_READY`（条目保持打开） |
| POST | `/inbox/:id/dismiss` | 仅 `failure` / `delivery` / `schedule_failure` 可忽略 |

`resolve` 是各业务动作的统一入口：`question` → 答案发回会话；`permission` → 回复 opencode（bash 请求选 `always` 时还把 payload 的每条子命令按「命令 + 开头的选项 + ` *`」记到项目，Git 与前置变量赋值的除外，D101）；`acceptance` → 节点 accept/reject；`plan` → 等同 plan confirm/replan；`failure` → 任务 retry/cancel（修改与跳过检查命令是任务的操作 `check-command` / `skip-check`，其中的重试同样关闭条目，D116）；`delivery` 不通过 resolve，而是 `deliver` 成功后自动 resolved；`schedule_failure` 同样不通过 resolve，恢复定时任务时自动 resolved（22 §5）。

## 8. Git 工作台（专业模式，27）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/git/status` | 主工作区：当前分支、提交、上游与 ahead/behind、是否干净、改动文件（porcelain 两字母代码）、未完成的操作 `operation`、提交身份 `identity`、上次获取时间 `fetchedAt` |
| GET | `/projects/:id/git/branches` | 本地与远端分支（不含 `origin/HEAD` 这类符号引用），标注当前分支与所属任务（`task: { id, key, status }`） |
| GET | `/projects/:id/git/log?ref&limit&cursor&author&search` | 提交列表 `{ items, nextCursor }`，`cursor` 为已显示的提交数；`author` 按作者姓名或邮箱、`search` 按提交信息筛选（不区分大小写），`search` 是 `ref` 上某个提交的 SHA 前缀时只返回该提交 |
| GET | `/projects/:id/git/commits/:sha?parent` | 提交详情（含提交者、包含它的本地分支）+ 相对第 `parent` 个父提交（默认 1）的文件列表（根提交与空树比较） |
| GET | `/projects/:id/git/diff?from&to` | 任意两个 ref 的文件列表 `DiffDTO` |
| GET | `/projects/:id/git/diff/file?from&to&path` | 单文件 unified diff（`FileDiffDTO`，超过 `DIFF_FILE_MAX_BYTES` 只返回大小） |
| GET | `/projects/:id/git/tree?ref&path` | 目录浏览（目录在前；`path` 为空即仓库根） |
| GET | `/projects/:id/git/file?ref&path` | 文件内容；二进制返回 `{ binary: true }`，超过 `DIFF_FILE_MAX_BYTES` 返回 `{ tooLarge: true, size }` |
| POST | `/projects/:id/git/fetch` | `git fetch --all --prune`（仓库锁内） |
| GET | `/projects/:id/git/changes` | 未提交的改动 `{ staged, unstaged, conflicted }`（`DiffFile[]`，未跟踪文件是 unstaged 中的 added，改名带 `oldPath`；合并冲突没解决完的路径只在 `conflicted` 中） |
| GET | `/projects/:id/git/changes/file?path&side` | 一个文件的 diff：`side = staged`（暂存区对 HEAD）或 `unstaged`（工作区对暂存区，未跟踪文件对空） |
| POST | `/projects/:id/git/stage`、`/unstage` | `{ paths }`：整文件暂存（含删除）/ 取消暂存（暂存的改名连同原路径一起取消），write |
| POST | `/projects/:id/git/commits` | `{ message }` → 201 新提交；以用户身份提交并运行钩子（钩子拒绝为 `GIT_COMMAND_FAILED`，stderr 为钩子输出）；`GIT_NOTHING_TO_COMMIT`、`GIT_IDENTITY_MISSING`、`GIT_OPERATION_IN_PROGRESS`，write |
| POST | `/projects/:id/git/commit-message` | `{}` 或 `{ from, to }` → `{ subject, body }`：AI 草拟已暂存改动或压缩合并的提交信息，等它写完（最长 `COMMIT_DRAFT_TIMEOUT_MS`）；`GIT_NOTHING_TO_COMMIT`、`COMMIT_DRAFT_FAILED`、`OPENCODE_NOT_READY`；read，不给助手 |
| GET | `/projects/:id/git/push?branch` | 推送预览：远端分支、是否新建、将推送的提交（最多 `GIT_PUSH_COMMITS_SHOWN` 个）与总数 |
| POST | `/projects/:id/git/push` | `{ branch }`：推送到 origin 的同名分支，不强推，没有上游时设为上游；绑定了远端时带项目令牌（D53），否则用用户自己的凭据；`GIT_PUSH_REJECTED`、`GIT_BRANCH_OWNED_BY_TASK`，critical |
| POST | `/projects/:id/git/pull` | 获取当前分支的上游并快进；`GIT_NO_UPSTREAM`、`WORKTREE_DIRTY`、`BRANCH_DIVERGED`，write |
| POST | `/projects/:id/git/branches` | `{ name, startPoint, switch }` → 204；名称不合法或以 `aw/` 开头 400 `VALIDATION_FAILED`，`GIT_BRANCH_EXISTS`；`switch` 时要求主工作区干净，write |
| POST | `/projects/:id/git/switch` | `{ branch }`：本地分支直接切换，远端分支建本地跟踪分支；`WORKTREE_DIRTY`、`GIT_BRANCH_IN_USE`、`GIT_BRANCH_EXISTS`、`GIT_BRANCH_OWNED_BY_TASK`，write |
| DELETE | `/projects/:id/git/branches/:name?force` | 删除本地分支；默认分支、当前分支或检出在别处 `GIT_BRANCH_IN_USE`，未合并且没有 `force` 时 `GIT_BRANCH_NOT_MERGED`，critical |
| POST | `/projects/:id/git/merge` | `{ source, target, strategy: merge \| squash, message }` → `{ merged: true, commit }` 或 `{ merged: false, conflictFiles }`（冲突时已中止，目标不变）；以用户身份；目标检出在主工作区时要求它干净（`WORKTREE_DIRTY`），检出在别处 `GIT_BRANCH_IN_USE`，任务分支 `GIT_BRANCH_OWNED_BY_TASK`，critical |
| POST | `/projects/:id/git/merge-task` | `{ source, target }` → 201 任务（`system.merge_branch` 系统流程，27 §3.6），write，`produces: task` |
| POST | `/projects/:id/git/pull-requests` | `{ branch, base, title, body }` → 201 `{ url, existed }`：该分支已有打开的 PR 时直接返回它；`HOSTING_NOT_CONFIGURED`，critical |
| POST | `/projects/:id/git/reviews` | `{ target, focus? }` → 201 审查 `GitReviewDTO`（`target`：`{ kind: worktree }`、`{ kind: commit, sha, parent? }`、`{ kind: branch, branch }`、`{ kind: range, from, to }`）；没有改动 400，同项目已有进行中的审查 409 `GIT_REVIEW_RUNNING`，`OPENCODE_NOT_READY`；write，`produces: git_review` |
| GET | `/projects/:id/git/reviews?to` | 审查列表，新的在前；`to` 只列该提交的 |
| GET | `/git/reviews/:reviewId` | 一次审查；`GIT_REVIEW_NOT_FOUND` |
| POST | `/git/reviews/:reviewId/stop` | 停止进行中的审查，write |
| GET | `/projects/:id/worktrees` | 所有 worktree（含非本应用创建的，标注 `managed`），关联任务、分支、脏状态、相对项目默认分支的 ahead/behind；目录已不存在的标 `prunable` |
| POST | `/projects/:id/worktrees/prune` | 删除终态任务遗留的 worktree（保留分支）并 `git worktree prune`，返回新的列表 |

不存在的 ref 或路径返回 404 `NOT_FOUND`（`details.object`）。

## 9. 数据库连接（专业模式）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/db-connections` | `{ items: DbConnectionDTO[] }`（`{ id, name, type, host, port, database, username, tls, createdAt, updatedAt }`，不含密码） |
| POST | `/db-connections` | `{ name, type, host, port, database, username, password, tls }`（`password` 为凭据字段，可为空串）→ 201；密码经 credentials 模块加密保存；名称已被使用 409 `DB_CONNECTION_ALREADY_EXISTS`（AI 的工具按名称找连接） |
| PATCH | `/db-connections/:id` | 部分字段；传 `password` 时替换密码 |
| DELETE | `/db-connections/:id` | 204；删除密码，项目关联随之删除 |
| POST | `/db-connections/:id/test` | `{ ok, serverVersion, error }`：连接并读取服务器版本（MySQL / GoldenDB `VERSION()`，PostgreSQL / openGauss `version()` 去掉构建信息，SQL Server `SERVERPROPERTY('ProductVersion')`）；连不上时 `ok: false`、`error` 为驱动信息（不作为 HTTP 错误） |
| GET | `/db-connections/:id/schema` | `{ tables: Array<{ name, comment?, rows?, columns: Array<{ name, type, nullable, key?, default?, comment? }> }> }`（只读浏览；范围与各类型的差异见 24 §3） |
| POST | `/db-connections/:id/query` | `{ sql, limit? }` → `{ columns, rows, truncated, elapsedMs }`：与 AI 的 `db_query` 同样的只读四道关（12 §6.11），但可用于任意连接；供应用助手使用（v1.1，15 §3） |

`type` 为 `DbType` 的五种之一（v1.2，24）。每次访问数据库都单独建立连接、用完关闭（连接超时 `DB_CONNECT_TIMEOUT_MS`）；连不上 502 `DB_CONNECTION_FAILED`（`details.driverMessage`）。

## 10. MCP 工具清单与操作清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/mcp/tools` 🅿 | `{ items: Array<{ name, description, inputSchema, allowedKinds }> }`：执行 MCP 的工具名（`McpToolName`）、给模型的说明（英文；工具页显示 `copy/runtime.ts` 中的中文说明）、输入 JSON Schema（不含注入的会话参数）、允许的尝试类型；与 `tools/list` 同序 |
| GET | `/operations?expose=palette` | `{ items: OperationInfo[] }`：命令面板可用的操作（`expose.palette` 且非 critical）：id、标题 key、说明、风险、最低模式、method、path、输入 JSON Schema；不带 `expose` 返回全部 |

## 11. SSE 事件

`GET /api/v1/events`（`Authorization` 通过查询参数 `?token=` 传递，因 EventSource 不支持头；仅本机）。

- 每条：`id: <bootId>-<seq>`（`bootId` 每次后端启动随机生成，`seq` 单调递增）、`event: <ServerEventType>`、`data: <JSON>`。
- 断线重连带 `Last-Event-ID`；服务端内存保留最近 `SSE_REPLAY_BUFFER` 条，能补则补；补不上（超出缓冲、或 `bootId` 不是本次启动）发送 `event: resync`（其 id 为当前位置），前端使所有查询失效重新拉取。首次连接（不带 `Last-Event-ID`）同样先收到 `resync`：页面在连上之前就读了数据，其间的事件无从补发，不重新拉取就会停在旧状态（如三条权限请求只显示两条，直到下一个相关事件）。
- 事件 schema 为 `shared/contracts/events` 的 `serverEventSchema`；各里程碑随实体加入对应事件。
- 事件只做「失效通知 + 必要增量」，前端以 TanStack Query 缓存为准：收到 `task.updated` 就 `setQueryData` 或 `invalidate` 对应 key。

| ServerEventType | data | 前端处理 |
| --- | --- | --- |
| `task.updated` | `TaskSummaryDTO` | 更新列表与详情缓存 |
| `node.updated` | `{ taskId, node: NodeSummaryDTO }` | 更新详情中的节点 |
| `plan.updated` | `{ taskId, plan: PlanDTO }` | |
| `attempt.updated` | `{ taskId, nodeId, attempt: AttemptSummaryDTO }`（调试尝试 `taskId`、`nodeId` 为 null） | 状态、提醒次数、当前进展变化时 |
| `attempt.transcript` | `{ attemptId, entries: TranscriptEntry[] }` | 追加到正在查看的会话流 |
| `inbox.updated` | `{ item: InboxItemDTO, blockingCount }` | 徽标（同 `/inbox/count`，D119）与列表 |
| `delivery.updated` | `{ taskId, delivery: DeliveryDTO }` | |
| `runtime.updated` | `RuntimeDTO` | 运行环境指示 |
| `settings.updated` | `{ keys: SettingKey[] }` | 重新拉设置（主题、模式即时生效） |
| `assistant.updated` | `AssistantConversationDTO` | 对话列表与面板（忙碌、待回复的权限请求） |
| `assistant.transcript` | `{ conversationId, entries: TranscriptEntry[] }` | 追加到面板的消息流；含 `confirmation`（确认卡片）、`attachment`（文件）、`entity_ref`（`{ kind, id, title }`，产出对象的导航卡片，D66）条目（10 §3） |
| `assistant.confirmation` | `AssistantConfirmationDTO` | 确认卡片的状态与结果 |
| `assistant.navigate` | `{ conversationId, target: AssistantPageRef }` | 助手调用 `open_page`：跳转，面板打开并显示该对话（目标为主页时由主页显示对话，D112） |
| `assistant.open_form` | `{ conversationId, form: AssistantForm, values }` | 助手调用 `open_form`：打开表单并预填（不含凭据字段） |
| `assistant.reveal_file` | `{ conversationId, absolutePath }` | 助手调用 `reveal_file`：经 preload 在 Finder 中显示 |
| `knowledge.updated` | `{ conversationId }` | 知识问答：新一轮、答案提交、一轮结束、权限请求等待或已处理、删除时；对话与列表重新拉取（研究过程与流式回答的草稿沿用 `attempt.transcript`：研究尝试的正文每 `KNOWLEDGE_DRAFT_FLUSH_CHARS` 个字符推送一次，草稿 = 最后一个非提交工具调用之后的正文，18 §5.5） |
| `browser.frame` | `BrowserFrame`（`{ attemptId, taskId, seq, tool, url, file }`） | AI 浏览器动作后的画面（v1.3 B2，29 §8.2）；任务页「预览」页签观看 AI 会话时跟随最新一张 |
| `browser.tab_updated` | `UserTabState`（`{ tabId, taskId, url, viewport, consoleErrors, failedRequests }`） | 用户的预览标签页换了页面、尺寸，或当前页面的控制台错误（含未捕获异常）与失败请求（网络错误或 ≥ 400）数变了（v1.3 B2，29 §8.1）；计数随主框架的新文档重新开始 |
| `preview.updated` | `Preview`（`{ taskId, state, url, logTail }`） | 页面预览（v1.3，29 §4.2）：每次状态变化后；任务页的预览页签直接用它更新 |
| `schedule.updated` | `{ scheduleId }` | 定时任务（v1.2）：创建、修改、暂停 / 恢复、每次运行、删除后；定时任务列表与详情重新拉取（查询挂在任务列表前缀下，开出的任务状态变化也会刷新，22 §9） |
| `git_review.updated` | `{ reviewId, projectId }` | Git 工作台的审查开始、提交问题、结束时；审查与列表重新拉取（27 §7.4） |
| `deck.updated` | `{ deckId }` | PPT：AI 工作开始与结束、每次提交通过、权限请求等待或已处理、页面修改、删除时；PPT 与列表重新拉取（23 §8） |
| `resync` | `{}` | 全部失效 |

## 12. 应用助手（v1.1）

见 [15-assistant.md](15-assistant.md)。这些操作 `expose.assistant = false`（助手不能确认自己的调用），也不进命令面板。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/assistant/conversations` | `{ items: AssistantConversationDTO[] }`，最近更新在前；`AssistantConversationDTO = { id, title, busy, pendingPermissions: Array<{ permissionId, permission, patterns }>, usage: AssistantUsageDTO, createdAt, updatedAt }`（`busy` 与权限请求只在内存中，重启后为空；`usage` 持久化） |
| POST | `/assistant/conversations` | `{ title? }` → 201；opencode 会话在第一条消息时创建 |
| POST | `/assistant/context-snapshots` | `assistant.snapshotContext`，`{ source: { kind: 'task', taskId, nodeId? } \| { kind: 'selection', text, page: AssistantPageRef } }` → 201 `AttachmentDTO`。用户显式附加文字，write，不暴露给助手或命令面板。任务／步骤信息由后端读取；不存在 404 `TASK_NOT_FOUND` / `NODE_NOT_FOUND`，步骤必须属于任务。选中文字 trim 后 1–12000 字符，超长／空白／多余字段 400 `VALIDATION_FAILED`；仅文字，NUL 等仍由附件边界拒绝。结果是固定的文本附件，使用现有查看、移除、绑定与清理接口 |
| GET | `/assistant/conversations/:id` | 不存在 404 `ASSISTANT_CONVERSATION_NOT_FOUND` |
| DELETE | `/assistant/conversations/:id` | 204；先中止运行并删除底层会话，失败保留本地对话以便重试；成功后清理确认、待发消息、任务跟进记录、消息流 JSONL 与 `files/<id>/`。正在异步建会话/发送或另一删除中返回 409 `ASSISTANT_BUSY`，防止孤儿会话和删除期间回传 |
| POST | `/assistant/conversations/:id/messages` | `{ text, context: AssistantPageRef }` → 对话；`AssistantPageRef = { page: AssistantPage, params: { taskId?, nodeId?, projectId?, workflowKey?, knowledgeConversationId?, deckId?, slideId?, batchId?, scheduleId? } }`（每个页面需要的参数见 `ASSISTANT_PAGE_PARAMS`），后端据此在本轮 `system` 中写明当前页面与选中对象的名称；正在创建会话、发送请求、删除或等待模型回复时 409 `ASSISTANT_BUSY` |
| POST | `/assistant/conversations/:id/abort` | 停止本轮回复 |
| PUT | `/assistant/conversations/:id/preview` | `assistant.bindPreview`，界面专用、不对助手开放；`{ preview: { taskId, tabId } \| null }` → 204。只接受属于该任务的真实用户预览，不能绑定 AI 页签；`null` 解除关联，删除后的清理也幂等。仅保存在内存 |
| POST | `/assistant/conversations/:id/permissions/:permissionId` | `{ reply: PermissionDecision }`：回复助手会话的权限请求（bash / webfetch 询问），不存在 404 `NOT_FOUND` |
| GET | `/assistant/conversations/:id/transcript?afterSeq=` | 消息流分页（非清单路由，格式同 `/attempts/:id/transcript`；`done` 恒为 false：对话不会结束） |
| GET | `/assistant/conversations/:id/files` | `{ items: Array<{ path, absolutePath, size, modifiedAt }> }`：`files/<id>/` 下助手写的文件 |
| GET | `/assistant/conversations/:id/confirmations` | `{ items: AssistantConfirmationDTO[] }`，按创建时间；`AssistantConfirmationDTO = { id, conversationId, operationId, title, risk, input, status, result: { ok: true, output } \| { ok: false, error } \| null, createdAt, resolvedAt }`；无返回值的成功操作及旧版缺失 output 的成功记录均返回 `output: null` |
| POST | `/assistant/confirmations/:id/confirm` | `{ alwaysAllow? }`：执行操作并把结果作为下一条消息发回会话；`alwaysAllow` 只允许 write 级（critical 400 `VALIDATION_FAILED`），同时把操作加入 `assistant.alwaysAllow`；已处理 409 `STATE_TRANSITION_INVALID`；不存在 404 `ASSISTANT_CONFIRMATION_NOT_FOUND` |
| POST | `/assistant/confirmations/:id/cancel` | 会话收到「用户取消了该操作」 |

| POST | `/assistant/whisper` | `assistant.whisper`，`{}` → `{ text }`（1–120 字符）；沿用默认模型，独立 `aw-companion` 会话，禁用全部工具，不保存到工作聊天；并发 409 `ASSISTANT_BUSY`，运行时不可用 `OPENCODE_NOT_READY`，空输出／模型错误／取消／超时 `OPENCODE_REQUEST_FAILED`。write，不暴露给助手或命令面板 |
| POST | `/assistant/whisper/stop` | `assistant.stopWhisper`，`{}` → 204；取消在途生成并清理临时会话；无在途请求时仍成功 |

确认结果与待发通知持久化在同一事务；会话忙、运行时不可用或发送失败时保留通知，重启后可随下一条用户消息投递，投递成功才移除，不重新执行业务操作。应用回传结果时，若用户上一条消息所在页面的对象已被删除，system 明确说明该页面已失效，仍正常发送结果；用户主动发送消息时仍严格校验所报页面对象。

助手通过 `tasks.create`（用户确认或已总是允许）创建的普通任务，后续 `review` / `failed` / `completed` 会回到原对话。HTTP 输入输出契约不变，不跟进界面直接创建、取消确认或其他对话的任务。通知带任务编号、页面链接、事件时间、已有结果及检查结论；失败带阶段与原因，完成带实际交付记录。`review` 仅表示等待验收；跳过的检查不算通过，创建 PR 不等于已合并。通知不触发重试或交付。应用启动与运行时恢复 ready 后尝试投递；助手忙时等本轮结束，发送失败仍可随下一条用户消息继续。外部已接收但本地未确认删除时的崩溃仍可能导致重复通知。

`AssistantUsageDTO = { latest: AssistantTurnDTO | null, recordedFrom: number | null, turns, unknownTurns, tokensInput: number | null, tokensOutput: number | null }`。`latest` 包含 `id, source, status, endReason, model, startedAt, endedAt, elapsedMs, tokensInput, tokensOutput, timeoutMs`。未开始记录时 `latest` / `recordedFrom` / tokens 为 null；已有轮次但模型未报告的用量仍为 null，累计只加已知报告，`unknownTurns` 单独列出。`source` 区分 `user` / `app`；结束状态与原因见 08。后端重启中断的耗时未知，其他结束轮次记录 Clock 的实际墙钟耗时；运行中读取时计算至当前时刻。`assistant.updated` 同步这些值，三个聊天入口共用。

桌宠复用全部对话端点，`AssistantPage.Desktop = desktop` 的参数为空。角色窗口的本地 IPC（`configure({ enabled, size })`、`setPanel(none | chat | bubble)`、`onLayout`）边界见 [32 §4](32-companion-assistant.md#4-实现分层)。

## 13a. 知识问答（v1.1）

见 [18-knowledge.md §4](18-knowledge.md#4-api操作清单)。全部 `mode = simple`、`expose.assistant = true`、不进命令面板（D68）。

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/knowledge/conversations?projectId&query&limit&cursor` | `knowledge.list` | read | `{ items: KnowledgeConversationSummaryDTO[], nextCursor }`，按 `updated_at` 倒序；`query` 匹配问题与回答 |
| GET | `/knowledge/conversations/:id` | `knowledge.get` | read | `KnowledgeConversationDTO`（全部轮次、状态、回答、引用、`awaitingInput`） |
| POST | `/knowledge/conversations` | `knowledge.ask` | read | `{ projectId, question, sources, model? }`（`model`：`provider/model`；`null` 为 opencode 默认；省略为 `ai.defaultModel`，D67 ④） → 201 详情；opencode 未就绪 503；项目无关联数据库却勾选数据库 400 |
| POST | `/knowledge/conversations/:id/turns` | `knowledge.followUp` | read | `{ question, model? }`（可换模型）；上一轮研究中 409 `KNOWLEDGE_CONVERSATION_BUSY` |
| POST | `/knowledge/conversations/:id/stop` | `knowledge.stop` | write | 中止研究中的一轮；已结束 409 `STATE_TRANSITION_INVALID` |
| DELETE | `/knowledge/conversations/:id` | `knowledge.delete` | critical | 204；研究中 409 |
| GET | `/knowledge/turns/:turnId/citations/:index` | `knowledge.citation` | read | `CitationSourceDTO`（18 §6.3）；404 `KNOWLEDGE_CITATION_NOT_FOUND` / `KNOWLEDGE_SOURCE_UNAVAILABLE` |

## 13b. 质量与用量（v1.1）

见 [19-insights.md §4](19-insights.md#4-api操作清单)。全部 `risk = read`、`mode = simple`、`expose.assistant = true`、不进命令面板（D79 ④）。

| 方法 | 路径 | 操作 | 说明 |
| --- | --- | --- | --- |
| GET | `/insights?period&from&to` | `insights.summary` | `InsightsSummaryDTO`：时间段（含时区）、tokens 用量合计（不含成本，D79）与按项目 / 流程 / 角色 / 模型 / 用途的拆分、按天趋势、质量、`attention`；`period = custom` 缺日期、其余时间段带日期、`from > to` 或超过 `INSIGHTS_MAX_DAYS` 天为 400 |
| GET | `/insights/tasks?period&from&to` | `insights.tasks` | `{ items: InsightsTaskDTO[] }`：时间段内结束或有用量的任务及其数字（钻取用） |

## 13c. 批量任务（v1.1）

见 [20-batch-tasks.md §7](20-batch-tasks.md#7-api-与操作清单)。全部 `mode = simple`、`expose.assistant = true`；`batches.create` 进命令面板。

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/batches?projectId&limit&cursor` | `batches.list` | read | `{ items: BatchSummaryDTO[], nextCursor }`，按编号倒序；游标为上一页最后一个批次的编号 |
| POST | `/batches` | `batches.create` | write | `{ projectId, workflowId, requirementTemplate, targets, baseBranch? }` → 201 `BatchDetailDTO`；只用 `fixed` 流程（否则 400 `VALIDATION_FAILED`，`path: ['workflowId']`）；模板须含 `{{target}}`，目标 1–20 个、单行、不重复，替换后的需求不超过 `REQUIREMENT_MAX_CHARS`；子任务 `confirm_plan = false`，创建后立即开始；`produces: batch` |
| GET | `/batches/:id` | `batches.get` | read | `BatchDetailDTO`（每个目标的任务摘要与本轮交付）；404 `BATCH_NOT_FOUND` |
| POST | `/batches/:id/deliver` | `batches.deliver` | critical | `{ strategy? }`（`squash` / `merge` / `rebase`，默认 `delivery.defaultStrategy`；报告流程一律 `report_only`）→ `{ batch, outcomes: [{ taskId, taskKey, target, outcome, error }] }`：按目标顺序逐个交付「待合并」的子任务（§5.3），冲突与失败的停在 `review`，其余继续 |

批次不新增 SSE 事件：进度随子任务的 `task.updated` 变化，前端批次查询挂在任务列表的缓存前缀下一并刷新。

## 13d. 定时任务（v1.2）

见 [22-scheduled-tasks.md §9](22-scheduled-tasks.md#9-api-与操作清单)。全部 `mode = simple`、`expose.assistant = true`；`schedules.create` 进命令面板。

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/schedules?projectId` | `schedules.list` | read | `{ items: ScheduleDTO[] }`，按创建时间倒序，不分页 |
| POST | `/schedules` | `schedules.create` | write | `{ projectId, workflowKey, requirement, frequency, baseBranch? }` → 201 `ScheduleDetailDTO`；只用 `fixed` 流程（否则 400 `VALIDATION_FAILED`，`path: ['workflowKey']`）；基础分支须存在（`GIT_BASE_BRANCH_NOT_FOUND`）；`produces: schedule` |
| GET | `/schedules/:id` | `schedules.get` | read | `ScheduleDetailDTO`（最近 `SCHEDULE_RUNS_SHOWN` 次运行）；404 `SCHEDULE_NOT_FOUND` |
| PATCH | `/schedules/:id` | `schedules.update` | write | `{ workflowKey?, requirement?, frequency?, baseBranch? }`（`baseBranch: null` 恢复默认分支，项目不能改）；改频率且启用中时重算 `nextRunAt` |
| POST | `/schedules/:id/pause` | `schedules.pause` | write | `active → paused`；非法转换 409 `STATE_TRANSITION_INVALID` |
| POST | `/schedules/:id/resume` | `schedules.resume` | write | `paused → active`，从现在起算下一次；关闭该定时任务的 `schedule_failure` 条目 |
| POST | `/schedules/:id/run` | `schedules.run` | write | 立即运行一次（`trigger = manual`，不改计划时刻）→ `ScheduleDetailDTO`；上一次的任务未结束 409 `SCHEDULE_BUSY`；开不了任务时直接返回错误（不自动暂停） |
| DELETE | `/schedules/:id` | `schedules.delete` | critical | 204；运行记录随之删除，开出的任务保留 |

## 13f. 页面预览（v1.3，29 §4）

`mode = simple`，不进命令面板。`get` / `start` / `stop` 已接入助手，启动和停止按 write 确认（支持「总是允许」）；主工作区的 `trial` 不暴露给助手。

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/tasks/:taskId/preview` | `previews.get` | read | `Preview`：`{ taskId, state, url, logTail }`；没有启动过的为 `stopped` |
| POST | `/tasks/:taskId/preview/start` | `previews.start` | write | 启动（或等待正在进行的启动）到就绪 → `Preview`。任务没有就绪的 worktree 409 `STATE_TRANSITION_INVALID`；项目没有预览设置 409 `PREVIEW_NOT_CONFIGURED`；没能就绪 502 `PREVIEW_START_FAILED`（`details.logTail`）；达到上限且都有标签页在用 409 `PREVIEW_LIMIT_REACHED`（`details: { maxRunning, taskIds }`，占用中的任务） |
| POST | `/tasks/:taskId/preview/stop` | `previews.stop` | write | → `Preview`（`stopped`） |
| POST | `/projects/:projectId/preview/trial` | `previews.trial` | write | 在主工作区启动一次（不运行安装命令），就绪后立即停止 → `{ url, logTail }`；没能就绪 502 `PREVIEW_START_FAILED` |

### 13f′. 网站登录（v1.3，29 §8.6）

`mode = simple`，不进命令面板与助手（网站登录是用户自己的事）。

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/browser/login-tabs` | `browser.openLoginTab` | write | `{ url }`（http(s)）→ 201 `{ tabId }`：在网站分区（`persist:aw-sites`）打开一个用户标签页，由界面经 `aw.browser.place` 放到窗口上；规则不允许的地址交给系统浏览器 |
| DELETE | `/browser/tabs/:tabId` | `browser.closeUserTab` | write | 204：关闭登录标签页或预览标签页（预览标签页同时注销对预览的使用） |
| GET | `/browser/site-logins` | `browser.listSiteLogins` | read | `{ hosts }`：网站分区里有 Cookie 的主机（用分区里一个临时离屏标签页的 `Network.getAllCookies`） |
| DELETE | `/browser/site-logins/:host` | `browser.clearSiteLogin` | write | 删除该主机的 Cookie 与页面存储（`Storage.clearDataForOrigin`）→ `{ hosts }` |
| POST | `/tasks/:taskId/preview/tabs` | `browser.openUserTab` | write | 启动任务的预览（需要时；达到上限 409 `PREVIEW_LIMIT_REACHED`，不排队）→ 201 `UserTabState`：用户自己的标签页（分区 `persist:aw-preview-<projectId>`，被测应用的登录保留），登记对预览的使用（不因空闲停止），打开项目的第一个关键页面，由界面经 `aw.browser.place` 放到窗口上；任务完成或取消时关闭（v1.3 B2，29 §8.1）。每个任务一个：再次打开返回同一个标签页，预览重启换了地址后回到第一个关键页面；同时的打开共用一次。从预览就绪起 30 秒内没打开好为 `BROWSER_READ_FAILED`（`reason: timeout`），新标签页随之关闭 |
| POST | `/browser/tabs/:tabId/navigate` | `browser.navigateUserTab` | read | `{ path }`（以 `/` 开头、不以 `//` 开头）在用户的预览标签页打开运行中的任务预览的这个路径；会离开预览来源的路径（如反斜线）400 `VALIDATION_FAILED`，预览没在运行 `BROWSER_NOT_OPEN`，页面没打开 `BROWSER_READ_FAILED`，30 秒没完成 `BROWSER_READ_FAILED`（`reason: timeout`，标签页保留）；不是预览标签页 404 `NOT_FOUND` |
| GET | `/browser/tabs/:tabId/logs` | `browser.userTabLogs` | read | `{ errors: [{ message, source }], requests: [{ method, url, status, error }] }`：用户预览标签页当前页面的控制台错误（含未捕获异常）与失败请求，底栏抽屉的明细（v1.3 B2） |
| POST | `/browser/tabs/:tabId/viewport` | `browser.setUserViewport` | read | `{ preset }`：桌面铺满放置区域，平板 / 手机在区域里模拟该尺寸（`Emulation.setDeviceMetricsOverride`）|
| GET | `/attempts/:attemptId/browser-frames` | `browser.listFrames` | read | `{ items: BrowserFrame[] }`：一次尝试的动作画面，按 `seq` 排列（读尝试目录里的 `frames.jsonl`，尝试结束、应用重启后照样可读；没有画面为空列表；v1.3 B2，29 §8.2） |

### 13f″. 助手网页文字读取（29 §9）

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| POST | `/browser/read-url` | `browser.readUrl` | read | `{ url }`（http(s)）→ `{ url, title, tab: 'site', page, settled, logs }`；`page` 为有长度限制的文字结构，`logs` 为控制台错误/提醒、异常与失败请求（12 §6.17） |

`mode = simple`、`expose.assistant = true`。使用 `persist:aw-sites` 的已有登录，按网站规则限制地址与重定向；即使某条规则是可操作，读取时也强制只读，拦截非 GET/HEAD/OPTIONS 请求与 WebSocket。无法归属标签页的 Worker 不继承权限，拒绝并记录日志。整体读取最长 `BROWSER_READ_TIMEOUT_MS`（30000），超时返回 502 `BROWSER_READ_FAILED`（`details.reason = timeout`）。临时标签页在成功、登录要求、导航失败或超时后均关闭，不改变用户的标签页与执行任务的浏览器会话。

错误：非法地址或 URL 中携带用户名/密码为 400 `VALIDATION_FAILED`；规则不允许的初始地址 403 `BROWSER_SITE_NOT_ALLOWED`；登录页 409 `BROWSER_LOGIN_REQUIRED`；导航失败（含被拒绝的重定向）502 `BROWSER_READ_FAILED`。没有图片/PDF、点击或输入能力。

### 13f‴. 用户预览页签（29 §8.1、§9）

用户预览页签的操作见 §13f′ 表中的 `browser.openUserTab` / `navigateUserTab` / `setUserViewport` / `userTabLogs`（只供界面使用，`expose.assistant = false`；B2 实现，项目的 `persist:aw-preview-<projectId>` 分区，与 AI 尝试页签分开，每个任务一个）。助手部分如下。

关闭仍使用 `DELETE /browser/tabs/:tabId`，同时删除它的会话关联。任务完成或取消也关闭页签。助手专用的 `browser_read` 没有 HTTP 操作和 tab 参数，只读取调用会话由界面关联的用户页，输出 `{ taskId, url, title, tab: 'preview', viewport, page, settled, logs }`。未关联或已失效返回 `BROWSER_NOT_OPEN`。离开任务预览页签立即解绑，助手/命令面板浮层仅隐藏原生视图，不解绑；首次发送消息先完成绑定更新，防止新对话误读旧页。

用户预览读取和导航也有 30 秒整体截止，超时为 `BROWSER_READ_FAILED`（`details.reason = timeout`）。读取或已有页的导航超时只结束本次等待、丢弃迟到结果，保留用户页及关联；用户解决页面对话框后可再读。首次打开在预览服务就绪后开始此截止，初始化/导航失败会关闭新页。应用退出中止所有用户浏览器等待，清理正在创建的页签，不等挂起的 CDP 回应；预览服务本身仍使用原有启动时限。

## 13e. PPT（v1.2）

见 [23-ppt.md §8](23-ppt.md#8-api操作清单)。全部 `mode = simple`、`expose.assistant = true`、不进命令面板（D96）；改动内容的 write 操作在有 AI 工作进行中时 409 `DECK_BUSY`；发起 AI 工作时 opencode 未就绪 503。`model` 同知识问答（`provider/model`、`null` 或省略）。

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/decks?projectId&query&limit&cursor` | `decks.list` | read | `{ items: DeckSummaryDTO[], nextCursor }`，按 `updated_at` 倒序；`query` 匹配标题 |
| GET | `/decks/:id` | `decks.get` | read | `DeckDTO`（要求、资料、理解、全部页、AI 工作记录、显示状态）；404 `DECK_NOT_FOUND` |
| POST | `/decks` | `decks.create` | write | `{ brief, projectId?, materials, slideCount?, theme?, model? }` → 201 `DeckDTO` 并开始写大纲；资料来自多个项目、任务没有结果、对话没有回答、资料超过 `DECK_MATERIALS_MAX_CHARS` 为 400；`produces: deck` |
| PATCH | `/decks/:id` | `decks.update` | write | `{ title?, theme? }`，不调用 AI |
| POST | `/decks/:id/outline/revise` | `decks.reviseOutline` | write | `{ instruction?, model? }`：按意见重写大纲；不带意见为重新写（大纲失败后重试）；已确认大纲 409 `STATE_TRANSITION_INVALID` |
| PUT | `/decks/:id/outline` | `decks.updateOutline` | write | `{ slides: [{ id?, layout, title, points }] }`：整体替换；已确认 409 |
| POST | `/decks/:id/generate` | `decks.generate` | write | `{ model? }`：第一次调用时确认大纲，制作全部未制作的页（也用于继续制作）；没有未制作的页 409 |
| POST | `/decks/:id/revise` | `decks.reviseSlides` | write | `{ slideIds, instruction, model? }`：页面必须都已制作 |
| PUT | `/decks/:id/slides/:slideId` | `decks.updateSlide` | write | `{ content, notes }`：手动修改，按 `slideContentSchema` 校验 |
| POST | `/decks/:id/slides/:slideId/restore` | `decks.restoreSlide` | write | 恢复 AI 最近一次修改之前的内容；没有上一版 409 |
| POST | `/decks/:id/slides` | `decks.insertSlide` | write | `{ afterSlideId?, layout, title, points, model? }`：加一页并只让 AI 做这一页（制作阶段） |
| POST | `/decks/:id/slides/:slideId/move` | `decks.moveSlide` | write | `{ toSeq }` |
| DELETE | `/decks/:id/slides/:slideId` | `decks.deleteSlide` | write | 最后一页不能删（409） |
| POST | `/decks/:id/stop` | `decks.stop` | write | 中止进行中的 AI 工作；已结束 409 |
| DELETE | `/decks/:id` | `decks.delete` | critical | 204；AI 工作中 409 `DECK_BUSY` |

导出不是 HTTP 操作：PowerPoint 在渲染进程生成，PDF 由 Electron main 打印 `/ppt/:id/print`（§13）。

## 13. preload 能力（非 HTTP）

```ts
interface AwBridge {
  apiToken: string;
  selectDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;       // 仅 http(s)
  revealInFinder(path: string): Promise<void>;
  appVersion: string;
  exportPdf(deckId: string, fileName: string): Promise<PdfExport>;       // 隐藏窗口打印 /ppt/:id/print，保存到用户选择的位置（23 §6.1）
  saveFile(fileName: string, bytes: Uint8Array): Promise<string | null>; // 渲染进程生成的文件（.pptx，23 §6.2）；取消为 null
  printSettled(result: PrintSettled): void;                              // 打印视图告诉隐藏窗口：可以打印，或为什么不能显示
  setLaunchPreferences(preferences: LaunchPreferences): void;           // 应用的主题与是否播放打开动画，main 写入 launch.json 供下次启动（28 §5.3）
  browser: {                                                             // 用户自己的浏览器标签页（v1.3，29 §8.1）；标签页由后端打开，非用户标签页不响应
    onShortcut(listener: (key: 'j' | 'k') => void): () => void;          // 用户页聚焦时转发 ⌘/Ctrl+J/K；卸载时取消监听
    place(tabId: string, rect: BrowserRect | null): void;                // 贴到窗口的这块区域（CSS 像素），null 为取下；main 按 browserRectSchema 解析
    back(tabId: string): void;
    forward(tabId: string): void;
    reload(tabId: string): void;
    openDevTools(tabId: string): void;
  };
}
type PrintSettled = { ok: true } | { ok: false; error: ErrorInfo };
type PdfExport = { ok: true; path: string | null } | { ok: false; error: ErrorInfo };   // path 为 null：用户取消了保存
```

加解密不暴露给 renderer：后端经 utilityProcess 与 main 之间的 `MessagePort` 请求 main 的 safeStorage。浏览器标签页同样：后端经同一通道发 `browser.request`（`shared/contracts/browser-port.ts`：`open` / `setPolicy` / `close` / `cdp`），main 回 `browser.response`，并主动发 `browser.cdpEvent` / `browser.blocked` / `browser.unownedBlocked`（无法归属标签页的 Worker 拦截，后端记日志）/ `browser.gone`（29 §5.1）。

## 14. 待实施 API：附件与需求清单

30 / 31（精简版）的契约设计，未注册到操作清单。

### 14.1 附件

| 操作 | 方法与路径 | 风险／曝光 | 输入 → 结果 |
| --- | --- | --- | --- |
| （非清单）上传 | POST `/attachments` | 仅 UI | `Content-Type: application/octet-stream` 的二进制请求体（后端按原始字节校验文本，30 §3.1）；`X-Attachment-Name` 为 URL 编码的文件名 → 201 `AttachmentDTO`；校验失败返回错误、不留记录 |
| （非清单）原件 | GET `/attachments/:id/content` | 仅 UI | 原件字节，`text/plain; charset=utf-8` 加 `nosniff` |
| attachments.snapshotProjectFile | POST `/attachments/project-file` | write；仅 UI | `{ projectId, taskId?, path, lines? }` → `AttachmentDTO` |
| attachments.get | GET `/attachments/:id` | read；UI | `AttachmentDTO`（不含绝对路径） |
| attachments.remove | DELETE `/attachments/:id` | write；仅 UI | 只能删除尚无引用的附件，已发送的返回 `VALIDATION_FAILED` |

以上为 U-01 已实现的部分。两条非清单路由使用与 JSON API 相同的令牌校验，不在 URL query 放令牌；原件以纯文本返回，不作为同源 HTML 执行。

`TaskDetailDTO` 增加 `attachments`（需求的附件，再加每次「再改改」的附件，按顺序；U-03）。`createTask`、`requestChanges`、助手发送消息增加可选 `attachmentIds`（最多 `ATTACHMENTS_PER_INPUT_MAX`，U-02 已实现），后端在业务写入时绑定：任务与需求同一事务，「再改改」挂在追加的修改节点上，助手消息挂在对话上（同一附件在后续消息再次发送不重复引用）；有不存在的 ID 时返回 `ATTACHMENT_NOT_FOUND`，任务不创建。助手调用 `tasks.create` 时可以带 `attachmentIds`，但只能是当前对话里用户发过的附件：助手层在执行或请求确认前检查（`OperationToolDeps.scoped`），别的 ID 直接返回 `ATTACHMENT_NOT_FOUND`、不出确认卡；确认卡把它们显示为文件名（`InputRef.Attachment`）。`requestChanges` 的 `attachmentIds` 仍列在 `assistantOmit` 里，助手不能代为附加。

### 14.2 需求清单

| 操作 | 方法与路径 | 风险／曝光 | 输入 → 结果 |
| --- | --- | --- | --- |
| requirements.get | GET `/tasks/:id/requirements` | read；UI / 助手 | 当前版本、逐项显示状态与最新结论、历史版本摘要 |
| requirements.replace | PUT `/tasks/:id/requirements` | write；UI / 助手确认 | `{ items }` → 新版本；确认卡列出每项与命令，突出删除和改为可选的项 |
| requirements.decide | POST `/tasks/:id/requirements/:itemId/decisions` | write；仅 UI（不向助手和命令面板曝光） | `{ conclusion: pass / fail / waive, note }`；waive 必须有 note；只在 `review` |
| tasks.reverifyRequirements | POST `/tasks/:id/requirements/reverify` | write；UI / 助手确认 | 只在 `review`；追加一个核验节点 |

- `createTask` 增加可选 `requirements: items`，与任务同一事务创建第一个版本。
- 交付（本地合并、创建／更新 PR、报告完成）增加可选 `acknowledgedRequirementsRevisionId`：界面对话框或助手确认卡列出未满足项时所依据的清单版本。有未满足的必需项时，缺少它或与当前版本不同都返回 `REQUIREMENTS_UNACKNOWLEDGED`，用户需要看着新版本重新确认；交付记录保存清单摘要。
- SSE：`requirements.updated { taskId }`，界面重新获取。
