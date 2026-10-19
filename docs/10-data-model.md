# 10 · 数据模型

## 1. 约定

- SQLite，WAL 模式，单连接。表定义用 Drizzle（`modules/<m>/<m>.table.ts`），迁移用 drizzle-kit 生成到 `packages/server/migrations/`，**已发布的迁移不修改**。
- 主键 `id TEXT`（`crypto.randomUUID()`）；时间 `INTEGER` 毫秒时间戳；JSON 列 `TEXT`，读写经 zod schema 解析（schema 在 `shared`）。
- 枚举列存枚举值字符串；不加 CHECK 约束（由 zod 与状态机保证），迁移更轻。
- 外键开启（`PRAGMA foreign_keys = ON`），删除策略在各表注明。
- 结构化、需查询的数据进 SQLite；大体量只追加的会话流进 JSONL。

## 2. 表

### settings

| 列 | 类型 | 说明 |
| --- | --- | --- |
| key | TEXT PK | 见 08 §4.3 |
| value | TEXT(JSON) | |
| updated_at | INTEGER | |

### credentials

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| kind | TEXT | `CredentialKind` |
| ciphertext | BLOB | safeStorage 加密结果 |
| created_at | INTEGER | |

### projects

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| name | TEXT | |
| slug | TEXT UNIQUE | worktree 目录名 |
| repo_path | TEXT UNIQUE | 仓库根目录绝对路径 |
| default_branch | TEXT | 添加时读取，可改 |
| check_command | TEXT NULL | 项目检查命令，验收中的 `$PROJECT_CHECK`（见 13 §1） |
| hosting_provider | TEXT NULL | `HostingProvider` |
| hosting_base_url | TEXT NULL | 自建 GitLab 地址；GitHub 为空 |
| hosting_repo | TEXT NULL | `owner/name` 或 GitLab project path |
| hosting_credential_id | TEXT NULL → credentials | ON DELETE SET NULL |
| created_at / updated_at | INTEGER | |

### db_connections

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| name | TEXT | |
| type | TEXT | `DbType` |
| host / port / database / username | TEXT / INTEGER / TEXT / TEXT | |
| credential_id | TEXT → credentials | |
| tls | INTEGER(bool) | |
| created_at / updated_at | INTEGER | |

### project_db_connections

| 列 | 类型 |
| --- | --- |
| project_id | TEXT → projects，ON DELETE CASCADE |
| db_connection_id | TEXT → db_connections，ON DELETE CASCADE |
| PK(project_id, db_connection_id) | |

### roles

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| key | TEXT UNIQUE | 如 `developer` |
| name | TEXT | |
| kind | TEXT | `RoleKind` |
| base_agent | TEXT | `RoleBaseAgent` |
| description | TEXT | |
| prompt | TEXT | 角色提示词（Markdown），作为会话 `system` 追加 |
| model | TEXT NULL | `provider/model`；空则用设置 `ai.defaultModel` 或 opencode 默认 |
| created_at / updated_at | INTEGER | |

### workflows

流程按版本存储，**行不可变**；编辑产生新版本行。任务引用具体版本行。`definition` 的 zod schema 为 `shared/workflow` 的 `workflowDefinitionSchema`（`planGraphSchema`、`acceptanceSchema` 同处）。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| key | TEXT | 如 `feature` |
| version | INTEGER | UNIQUE(key, version) |
| is_latest | INTEGER(bool) | |
| kind | TEXT | `WorkflowKind` |
| name / description | TEXT | |
| planning | TEXT | `WorkflowPlanning` |
| deliverable | TEXT | `WorkflowDeliverable` |
| definition | TEXT(JSON) | `WorkflowDefinition`，见下 |
| created_at | INTEGER | |

```ts
type WorkflowDefinition = {
  allowedRoles: string[];                 // 角色 key
  plannerRole?: string;                   // planning=ai 时必填，base_agent 必须为 planner
  plannerGuidance?: string;               // 给规划者的流程说明（Markdown）
  requiredSteps?: Array<PlanNodeSpec & { position?: 'first' | 'last' }>;  // planning=ai 时必须包含的节点（按 key 校验）
  template?: PlanGraph;                   // planning=fixed 时的固定计划
  checkpoints: { confirm_plan: boolean; accept_each_node: boolean };
  defaultAcceptance: Acceptance;          // 节点未声明验收时使用
};
type PlanGraph = { nodes: PlanNodeSpec[] };
type PlanNodeSpec = {
  key: string;                            // [a-z0-9_]{1,40}
  title: string;
  roleKey: string;
  instructions: string;
  dependsOn: string[];
  acceptance?: Acceptance;
  kind?: 'normal' | 'revise';
};
type Acceptance = {
  checks: Array<{ kind: 'command'; command: string } | { kind: 'ai_review'; focus?: string }>;
  manual: boolean;
};
```

### tasks

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| seq | INTEGER UNIQUE | 自增编号 |
| key | TEXT UNIQUE | `T-<seq>` |
| project_id | TEXT → projects | ON DELETE RESTRICT |
| workflow_id | TEXT → workflows | 具体版本 |
| title | TEXT | 未填时由需求首行截取 |
| requirement | TEXT | |
| status | TEXT | `TaskStatus` |
| failed_phase | TEXT NULL | `TaskFailedPhase` |
| failure | TEXT(JSON) NULL | `{ code, message, details? }` |
| checkpoints | TEXT(JSON) | 启动时解析后的 `{ confirm_plan, accept_each_node, ask_on_uncertainty }` |
| base_branch | TEXT | |
| base_commit | TEXT NULL | worktree 创建时的基线 |
| branch | TEXT NULL | |
| current_plan_id | TEXT NULL → plans | 当前生效（confirmed）版本 |
| result | TEXT(JSON) NULL | 结果卡数据：`{ summary, filesChanged, insertions, deletions, checks[], nodeSummaries[] }` |
| created_at / updated_at / started_at / finished_at | INTEGER | |

索引：`(project_id, status)`、`(status, updated_at)`。

### task_events

任务域时间线（状态转换与关键事件），只追加。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | 也作 SSE 事件 id 的一部分 |
| task_id | TEXT → tasks，ON DELETE CASCADE | |
| entity | TEXT | `task` / `node` / `attempt` / `plan` / `delivery` |
| entity_id | TEXT | |
| type | TEXT | 状态机事件名或 `note` |
| from_status / to_status | TEXT NULL | |
| payload | TEXT(JSON) NULL | |
| created_at | INTEGER | |

### plans

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| task_id | TEXT → tasks，CASCADE | |
| version | INTEGER | UNIQUE(task_id, version) |
| status | TEXT | `PlanStatus` |
| source | TEXT | `PlanSource` |
| graph | TEXT(JSON) | `PlanGraph` |
| summary | TEXT NULL | 规划者对计划的说明 |
| assumptions | TEXT(JSON) | `string[]` |
| feedback | TEXT NULL | 产生本版本的用户反馈（重新规划 / 再改改） |
| created_by_attempt_id | TEXT NULL | |
| created_at / confirmed_at | INTEGER | |

### nodes

计划确认时由 `PlanGraph` 物化；调整计划时只增删改未开始的节点。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| task_id | TEXT → tasks，CASCADE | UNIQUE(task_id, key) |
| plan_id | TEXT → plans | 最后一次定义它的计划版本 |
| key / title | TEXT | |
| role_id | TEXT → roles | |
| instructions | TEXT | |
| depends_on | TEXT(JSON) | node key 列表 |
| acceptance | TEXT(JSON) | 解析后的 `Acceptance` |
| kind | TEXT | `normal` / `revise` |
| status | TEXT | `NodeStatus` |
| attempt_count | INTEGER | 消耗的预算 |
| retry_feedback | TEXT NULL | 下次尝试附带 |
| result | TEXT(JSON) NULL | 最近一次 `submit_result` 内容 |
| check_results | TEXT(JSON) NULL | `[{ kind, passed, output, attemptId? }]` |
| commit_sha | TEXT NULL | |
| position | INTEGER | 画布与列表排序 |
| created_at / updated_at / started_at / finished_at | INTEGER | |

索引：`(task_id, status)`。

### attempts

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| task_id | TEXT → tasks，CASCADE | |
| node_id | TEXT NULL → nodes，CASCADE | `plan` 类为空 |
| kind | TEXT | `AttemptKind` |
| seq | INTEGER | 同一节点（或同一任务的 plan 类）内序号 |
| status | TEXT | `AttemptStatus` |
| role_id | TEXT → roles | |
| model | TEXT NULL | 实际使用的模型 |
| opencode_session_id | TEXT NULL UNIQUE | MCP 调用归属的依据 |
| nudges | INTEGER | |
| error | TEXT(JSON) NULL | `{ code, message, details? }` |
| tokens_input / tokens_output | INTEGER NULL | |
| cost | REAL NULL | |
| started_at / ended_at | INTEGER | |

索引：`(node_id)`、`(task_id, kind)`、`(status)`。

### inbox_items

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| kind | TEXT | `InboxKind` |
| status | TEXT | `InboxStatus` |
| task_id / node_id / attempt_id | TEXT NULL | 关联，CASCADE |
| title | TEXT | |
| payload | TEXT(JSON) | 按 kind，见下 |
| response | TEXT(JSON) NULL | 用户回应 |
| created_at / resolved_at | INTEGER | |

索引：`(status, created_at)`、`(task_id)`。

payload / response：

| kind | payload | response |
| --- | --- | --- |
| `question` | `{ question, options?: string[], blocking: boolean, defaultAssumption?: string }` | `{ answer: string }` 或 `{ assumed: true, value }`（未问用户、按假设继续时直接以 resolved 写入，作为记录） |
| `permission` | `{ opencodePermissionId, sessionId, type, title, pattern?, metadata }` | `{ decision: PermissionDecision }` |
| `acceptance` | `{}` | `{ accepted: boolean, feedback?: string }` |
| `plan` | `{ planId, version }` | `{ confirmed: true }` 或 `{ replanFeedback }` |
| `failure` | `{ phase, error }` | `{ action: 'retry' | 'cancel' }` |
| `delivery` | `{}` | `{ deliveryId }` |

### worktrees

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects | |
| task_id | TEXT UNIQUE → tasks | |
| path | TEXT UNIQUE | |
| branch | TEXT | |
| base_commit | TEXT | |
| status | TEXT | `WorktreeStatus` |
| error | TEXT NULL | |
| created_at / removed_at | INTEGER | |

### deliveries

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| task_id | TEXT → tasks，CASCADE | |
| strategy | TEXT | `DeliveryStrategy` |
| target_branch | TEXT | |
| status | TEXT | `DeliveryStatus` |
| commit_sha | TEXT NULL | 本地合并产生的提交 |
| pr_url | TEXT NULL | |
| conflict_files | TEXT(JSON) NULL | |
| error | TEXT(JSON) NULL | |
| created_at / finished_at | INTEGER | |

## 3. JSONL 会话流

路径：`<数据目录>/runs/<taskId>/<attemptId>.jsonl`。每次尝试一个文件，只追加，由 opencode 事件桥写入，同时经 SSE 推送 `attempt.transcript` 事件。

每行：

```json
{ "seq": 12, "ts": 1760851200000, "kind": "tool_call", "partId": "prt_...", "data": { "tool": "edit", "input": { "filePath": "src/a.ts" } } }
```

| kind | data |
| --- | --- |
| `user_message` | `{ text }`（我们发给会话的提示词 / 答案 / 提醒） |
| `text` | `{ text }`（模型正文；流式时同一 `partId` 多行，读取时按 partId 取最后一行） |
| `reasoning` | `{ text }` |
| `tool_call` | `{ tool, callId, input }` |
| `tool_result` | `{ tool, callId, status: 'completed' | 'error', output, error? }` |
| `file_edit` | `{ path, additions, deletions }` |
| `permission` | `{ permissionId, type, title, decision? }` |
| `system` | `{ message }`（如「尝试开始」「已提醒提交结果」） |
| `error` | `{ code, message }` |

读取：`GET /attempts/:id/transcript?afterSeq=` 顺序读取文件并按 `afterSeq` 过滤，每页 `TRANSCRIPT_PAGE_SIZE`。单文件预计 < 10 MB，M6 做性能验证，必要时加 seq → 偏移量索引。

## 4. v1.1 预留：助手

`assistant_conversations`（id、title、opencode_session_id、created_at、updated_at）与 `assistant_confirmations`（id、conversation_id、operation_id、input JSON、status `pending/confirmed/cancelled`、result JSON、created_at、resolved_at）在 v1.1 以新迁移加入，v1.0 不建表。见 [15-assistant.md](15-assistant.md)。

## 5. 删除与清理

- 删除项目：要求无非终态任务；级联删除其任务及全部关联数据和 `runs/<taskId>` 目录。
- 任务终态后 worktree 删除，但任务、计划、节点、尝试、会话流保留（供回看）。
- 不做自动过期清理（v1）。设置页显示数据目录占用。
