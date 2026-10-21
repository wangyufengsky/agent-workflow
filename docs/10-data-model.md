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
| name | TEXT UNIQUE | AI 的数据库工具按名称找连接 |
| type | TEXT | `DbType`（v1.2 起五种，24 §1） |
| host / port / database / username | TEXT / INTEGER / TEXT / TEXT | |
| credential_id | TEXT → credentials | 密码；删除连接后删除凭据 |
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

流程按版本存储，**行不可变**；编辑产生新版本行。任务引用具体版本行。删除自定义流程时，被任务引用的版本保留并把该 key 的 `is_latest` 全部置否（不再列出），其余版本删除；同一 key 之后可再次使用，版本号接在保留的版本之后。`definition` 的 zod schema 为 `shared/workflow` 的 `workflowDefinitionSchema`（`planGraphSchema`、`acceptanceSchema` 同处）。

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
| current_plan_id | TEXT NULL | 当前生效（confirmed）版本（无外键：plans 引用 tasks，两张表不能互相引用，D43） |
| result | TEXT(JSON) NULL | 结果卡数据 `TaskResultDTO`：`{ summary, filesChanged, insertions, deletions, files[], checks[], nodeSummaries[], assumptions[] }`（进入 `review` 时生成） |
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
| check_results | TEXT(JSON) NULL | `CheckResult[]`：命令检查 `{ kind: command, command, passed, output, exitCode, timedOut }`（输出保留末尾 `ACCEPTANCE_OUTPUT_MAX_CHARS`）；AI 评审 `{ kind: ai_review, focus, passed, output, attemptId, issues[] }` |
| commit_sha | TEXT NULL | |
| position | INTEGER | 画布与列表排序 |
| created_at / updated_at / started_at / finished_at | INTEGER | |

索引：`(task_id, status)`。

### attempts

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| task_id | TEXT NULL → tasks，CASCADE | 空 = 调试尝试（仅开发构建，M2-09）或知识问答的 `research` 尝试（v1.1，由 `knowledge_turns` 指向），不属于任何任务 |
| node_id | TEXT NULL → nodes，CASCADE | `execute` 类为所执行的节点，`review` 类为被评审的节点；`plan` 类与调试尝试为空 |
| kind | TEXT | `AttemptKind` |
| seq | INTEGER | 同一节点（或同一任务的 plan 类、或不属于任务的同类尝试）内序号 |
| status | TEXT | `AttemptStatus` |
| role_id | TEXT NULL → roles | 调试尝试为空 |
| model | TEXT NULL | 发送提示词时指定的 `provider/model`；空 = opencode 默认 |
| directory | TEXT | 会话工作目录（任务 worktree） |
| opencode_session_id | TEXT NULL | MCP 调用归属的依据；不唯一：重新规划沿用原规划会话（12 §4.3），归属取该会话最新的尝试 |
| nudges | INTEGER | |
| error | TEXT(JSON) NULL | `{ code, message, details? }` |
| tokens_input / tokens_output | INTEGER NULL | |
| cost | REAL NULL | |
| started_at / ended_at | INTEGER | |

索引：`(node_id)`、`(task_id, kind)`、`(status)`、`(opencode_session_id)`、`(started_at)`（质量与用量按时间区间统计，19 §5）。


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

索引：`(status, created_at)`、`(task_id)`、`(created_at)`（质量与用量统计打扰次数，19 §5）。

payload / response：

| kind | payload | response |
| --- | --- | --- |
| `question` | `{ question, options?: string[], blocking: boolean, defaultAssumption?: string }` | `{ answer: string }` 或 `{ assumed: true, value }`（未问用户、按假设继续时直接以 resolved 写入，作为记录） |
| `permission` | `{ opencodePermissionId, sessionId, directory, permission, patterns[] }` | `{ decision: PermissionDecision }` |
| `acceptance` | `{}` | `{ accepted: boolean, feedback?: string }` |
| `plan` | `{ planId, version }` | `{ confirmed: true }` 或 `{ replanFeedback }` |
| `failure` | `{ phase, error }` | `{ action: 'retry' | 'cancel' }` |
| `delivery` | `{}` | `{ deliveryId }` |

`title` 是简短的纯文本（问题原文、权限的命令、步骤或任务标题），卡片按 kind 组织其余文案。问题与权限条目的 `attempt_id` 是发起的尝试，尝试结束时其仍打开的条目自动 dismiss；验收、计划、失败、投递条目不关联尝试。

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

一个任务只有一条记录：以 PR 交付的任务按审查意见修改时，已删除的 worktree 在原路径与分支上重建（状态 `removed → creating → ready`，`removed_at` 清空，`base_commit` 不变；21 §4.2）。

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

路径：`<数据目录>/runs/<taskId>/<attemptId>.jsonl`（调试尝试为 `runs/debug/<attemptId>.jsonl`，知识问答的 `research` 尝试为 `runs/knowledge/<attemptId>.jsonl`）。每次尝试一个文件，只追加（同步追加，保持事件顺序），由尝试模块把 opencode 事件转换后写入，同时经 SSE 推送 `attempt.transcript` 事件。schema 为 `shared/contracts/api/attempts.ts` 的 `transcriptEntrySchema`。

每行：

```json
{ "seq": 12, "ts": 1760851200000, "kind": "tool_call", "data": { "tool": "edit", "callId": "call_...", "input": { "filePath": "src/a.ts" } } }
```

| kind | data |
| --- | --- |
| `user_message` | `{ text }`（我们发给会话的提示词 / 答案 / 提醒） |
| `text` | `{ text }`，带 `partId`（模型正文；流式时同一 `partId` 多行，每行是到当时为止的全文：每增长 `TRANSCRIPT_TEXT_FLUSH_CHARS` 写一次（知识问答的 `research` 尝试为 `KNOWLEDGE_DRAFT_FLUSH_CHARS`，回答草稿因此流式显示，18 §5.5），片段结束再写一次；读取时按 `partId` 取最后一行） |
| `reasoning` | 同 `text` |
| `tool_call` | `{ tool, callId, input }`（工具开始运行时一次） |
| `tool_result` | `{ tool, callId, status: 'completed' \| 'error', output?, error? }` |
| `file_edit` | `{ path, additions, deletions }`（预留，M2 未产生；编辑以 `tool_call` / `tool_result` 出现） |
| `permission` | `{ permissionId, permission, patterns }` |
| `system` | `{ event: TranscriptSystemEvent, detail? }`（尝试开始、已提醒、重试中、已提交、超时、已中止、运行时消失；文案在前端） |
| `error` | `ErrorInfo`（`{ code, message, details? }`；尝试结束后的会话错误不记录，如提交后我们发出的中止） |
| `confirmation` | `{ confirmationId }`（仅助手对话：一次等待用户确认的调用，卡片内容来自 `assistant_confirmations`） |
| `attachment` | `{ path }`（仅助手对话：助手写入对话文件目录 `files/<id>/` 的文件，`path` 相对该目录） |
| `entity_ref` | `{ kind: EntityKind, id, title }`（仅助手对话：助手调用的操作执行成功后产出的对象，界面渲染为导航卡片，D66） |

读取：`GET /attempts/:id/transcript?afterSeq=` 每页 `TRANSCRIPT_PAGE_SIZE` 行；seq 从 1 起逐行连续编号（第 i 行即 seq i+1），所以一页就是按行切出的一段，只解析这一段（M6-02：5 MB、约六千行的文件，每页约 20 ms）；页内同一 `partId` 只保留最后一行、放在它首次出现的位置。界面先显示第一页，其余页在后台接着读；读页期间经 SSE 到达的行另存一处，显示时与各页按 seq 去重合并（`transcriptEntries`），因此读页与追加交错时不丢行。

## 4. 助手（v1.1）

见 [15-assistant.md](15-assistant.md)，迁移 `0008`。

### assistant_conversations

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| title | TEXT | 默认取第一条消息的首行（`ASSISTANT_TITLE_MAX_CHARS`） |
| opencode_session_id | TEXT NULL | 第一条消息时创建；MCP 调用归属的依据 |
| created_at / updated_at | INTEGER | `updated_at` 随每条消息更新，列表按它倒序 |

索引：`(opencode_session_id)`、`(updated_at)`。

### assistant_confirmations

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| conversation_id | TEXT → assistant_conversations，CASCADE | |
| operation_id | TEXT | 操作清单 id |
| input | TEXT(JSON) | 助手给出的参数（已按助手 schema 校验，不含凭据字段） |
| status | TEXT | `AssistantConfirmationStatus`（09 §10） |
| result | TEXT(JSON) NULL | 确认后：`{ ok: true, output }` 或 `{ ok: false, error }`；取消为空 |
| created_at / resolved_at | INTEGER | |

索引：`(conversation_id, created_at)`。

消息流：`<数据目录>/assistant/conversations/<id>.jsonl`，格式同 §3（多 `confirmation`、`attachment`、`entity_ref` 三种条目）；记录用户的消息、模型的正文与工具调用、权限请求、错误；后端代发的确认结果消息与每轮注入的 `system` 不记录（卡片显示结果）。

## 4a. 知识问答（v1.1）

见 [18-knowledge.md §3](18-knowledge.md#3-数据模型)，迁移 `0009_knowledge`。

### knowledge_conversations

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects，CASCADE | |
| title | TEXT | 第一次提问的首行（`KNOWLEDGE_TITLE_MAX_CHARS`） |
| sources | TEXT(JSON) | `{ code, docs, database, web }`，对话开始后固定（D67） |
| created_at / updated_at | INTEGER | `updated_at` 随每一轮的创建与结束更新 |

索引：`(project_id)`、`(updated_at)`。

### knowledge_turns

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| conversation_id | TEXT → knowledge_conversations，CASCADE | |
| seq | INTEGER | 对话内序号，从 1 起 |
| question | TEXT | |
| attempt_id | TEXT → attempts | 这一轮的 `research` 尝试；状态与模型（`model` 列，D67 ④）由它推导，不另存 |
| answer | TEXT NULL | `submit_answer` 通过校验后写入 |
| citations | TEXT(JSON) NULL | `CitationDTO[]` |
| created_at / answered_at | INTEGER | |

索引：`(conversation_id, seq)` 唯一、`(attempt_id)`。

## 4b. 批量任务（v1.1）

见 [20-batch-tasks.md §6](20-batch-tasks.md#6-数据模型迁移-0011_batches)，迁移 `0011_batches`。批次没有状态列，进度由子任务推导（D85）。

### batches

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| seq | INTEGER UNIQUE | 编号 `B-<seq>` |
| project_id | TEXT → projects，CASCADE | |
| workflow_id | TEXT → workflows | 流程版本（必须是 `fixed`） |
| title | TEXT | 需求模板首行 |
| requirement_template | TEXT | 含 `{{target}}` |
| base_branch | TEXT | 全部子任务的基础分支 |
| created_at | INTEGER | |

### batch_tasks

| 列 | 类型 | 说明 |
| --- | --- | --- |
| batch_id | TEXT → batches，CASCADE | 与 `position` 组成主键 |
| task_id | TEXT → tasks，CASCADE，UNIQUE | |
| position | INTEGER | 目标顺序，从 0 起 |
| target | TEXT | 目标原文 |

## 5. 删除与清理

- 删除项目：要求无非终态任务、没有研究中的知识对话；级联删除其任务及全部关联数据和 `runs/<taskId>` 目录，以及知识对话、其 `research` 尝试与会话流，以及批次（外键级联，20 §6）。
- 删除知识对话：要求没有研究中的一轮；删除轮次、其尝试（权限条目随之级联）与 `runs/knowledge/<attemptId>.jsonl`。
- 删除助手对话：级联删除其确认，并删除 `assistant/conversations/<id>.jsonl` 与 `assistant/files/<id>/`。
- 任务终态后 worktree 删除，但任务、计划、节点、尝试、会话流保留（供回看）。
- 不做自动过期清理（v1）。设置页显示数据目录占用。
