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
| seal | TEXT | `CredentialSeal`，默认 `system`（D167，迁移 `0031_credential_master_password`）：由系统密钥服务还是主密码加密；主密码重置后为 `discarded` |
| ciphertext | BLOB | `system`：safeStorage 加密结果；`master_password`：nonce ‖ AES-256-GCM 密文 ‖ tag（数据密钥加密）；`discarded`：空 |
| created_at | INTEGER | |

保存与替换时，系统密钥服务可用就用它，否则用已解锁的主密码；读取按这一行的 `seal`。

### credential_vault

主密码（D167），至多一行（`id` 为 1）。随机的 32 字节数据密钥加密凭据；它被主密码经 scrypt 派生的密钥包住存在这里，只在解锁后留在后端内存。修改主密码只重新包住数据密钥；重置时在同一事务里删除这一行，并把 `seal = master_password` 的凭据改为 `discarded`、清空密文（引用它们的项目、数据库连接、全局令牌保留，重新填写时替换）。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | 1 |
| salt | BLOB | 16 字节 |
| scrypt_n / scrypt_r / scrypt_p | INTEGER | 派生时用的参数（`MASTER_PASSWORD_SCRYPT`） |
| wrapped_key | BLOB | nonce ‖ AES-256-GCM(数据密钥) ‖ tag；主密码不对时 tag 校验失败 |
| created_at / updated_at | INTEGER | |

### projects

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| name | TEXT | |
| slug | TEXT UNIQUE | worktree 目录名 |
| repo_path | TEXT UNIQUE | 仓库根目录绝对路径 |
| default_branch | TEXT | 添加时读取，可改 |
| acceptance_mode | TEXT NOT NULL DEFAULT `auto` | `auto` 自动验收，`command` 使用配置的检查命令。迁移保留已有命令。 |
| check_command | TEXT NULL | 项目检查命令，验收中的 `$PROJECT_CHECK`（见 13 §1） |
| preview | TEXT(JSON) NULL | 页面预览设置 `ProjectPreview`（29 §4.1，迁移 `0016_project_preview`）：读出时按 `projectPreviewSchema` 解析；null 为没有预览。预览本身只在内存里，不建表 |
| hosting_provider | TEXT NULL | `HostingProvider` |
| hosting_base_url | TEXT NULL | 自建 GitLab 地址；GitHub 为空 |
| hosting_repo | TEXT NULL | `owner/name` 或 GitLab project path |
| hosting_credential_id | TEXT NULL → credentials | ON DELETE SET NULL |
| created_at / updated_at | INTEGER | |

### project_runtime_checks

每个项目至多保存一条最近运行检查：`project_id` 为指向 projects 的主键（删除项目时级联删除），`result` 为按契约校验的 JSON，记录配置快照、时间、分支与分项结果。临时工作区清理日志独立保存在数据目录；项目删除不会删除仍需收尾的日志。

### hosting_accounts

全局 GitHub / GitLab 令牌（D155，迁移 `0029_hosting_accounts`），项目没有自己的令牌时按 origin 的平台地址使用。每个平台地址（`provider` + `base_url`）至多一行：唯一索引 `(provider, coalesce(base_url, ''))`；再次保存时先加密新令牌，再在同一步里替换这一行的凭据并删除旧凭据。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| provider | TEXT | `HostingProvider` |
| base_url | TEXT NULL | 自建 GitLab 地址（无末尾斜杠）；github.com 与 gitlab.com 为空 |
| account | TEXT | 令牌登录的用户名，保存时读取 |
| credential_id | TEXT → credentials | 令牌；删除这一行后删除凭据 |
| created_at / updated_at | INTEGER | |

### db_connections

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| name | TEXT UNIQUE | AI 的数据库工具按名称找连接 |
| type | TEXT | `DbType`（v1.2 起五种，24 §1） |
| host / port / database / username | TEXT / INTEGER / TEXT / TEXT | |
| credential_id | TEXT → credentials | 密码；删除连接后删除凭据 |
| tls_mode | TEXT | `DbTlsMode`（D166）；迁移 `0030_db_tls_mode` 把原来的 `tls = 1` 改为 `verify`，其余为 `off` |
| created_at / updated_at | INTEGER | |

### project_db_connections

| 列 | 类型 |
| --- | --- |
| project_id | TEXT → projects，ON DELETE CASCADE |
| db_connection_id | TEXT → db_connections，ON DELETE CASCADE |
| PK(project_id, db_connection_id) | |

### project_bash_rules（v1.2 后，D101）

项目中「总是允许」的 bash 模式；项目之后新建的只读会话带上它们（12 §2）。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| project_id | TEXT → projects，ON DELETE CASCADE | |
| pattern | TEXT | opencode 通配模式，如 `unzip *` |
| created_at | INTEGER | 首次记下的时间；再次「总是允许」不更新 |
| PK(project_id, pattern) | | |

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

### browser_cases

项目内保存的浏览器用例。列为 `id`（主键）、`project_id`（项目删除时级联）、`revision`（从 1 递增）及 `definition`（JSON，含名称、授权范围与有序步骤）。索引 `browser_cases_project_idx` 用于项目列表。每次执行冻结的定义写到 `tasks.browser_case`，步骤证据保存在节点与任务结果的 `browserCaseReport` 字段。迁移 0045。

### tasks

`skills` 为创建任务时保存的有序 JSON 快照，每项包含 `id`、`name`、`version`、`body` 和可选的 `roleIds`。未指定角色或角色值为 null 时应用于任务的全部角色。旧任务默认空数组。任务使用快照中的版本及角色范围。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| seq | INTEGER UNIQUE | 编号，取自 `app_counters.task_seq`，删除任务或项目后也不复用（D223） |
| key | TEXT UNIQUE | `T-<seq>` |
| project_id | TEXT → projects | ON DELETE RESTRICT |
| workflow_id | TEXT → workflows | 具体版本 |
| title | TEXT | 未填时由需求首行截取 |
| requirement | TEXT | |
| browser_test | TEXT nullable | 浏览器测试任务创建时确认的目标与 HTTP 写请求规则，JSON。迁移 0044，历史任务为 null |
| browser_case | TEXT nullable | 本次运行使用的固定用例定义和版本，JSON。迁移 0045，临时测试为 null |
| status | TEXT | `TaskStatus` |
| failed_phase | TEXT NULL | `TaskFailedPhase` |
| failure | TEXT(JSON) NULL | `{ code, message, details? }` |
| checkpoints | TEXT(JSON) | 启动时解析后的 `{ confirm_plan, accept_each_node, ask_on_uncertainty }` |
| base_branch | TEXT | |
| base_commit | TEXT NULL | worktree 创建时的基线 |
| branch | TEXT NULL | |
| merge_source | TEXT NULL | 合并任务的来源（27 §3.6，迁移 `0015_git_workbench`）：worktree 从它建出，准备阶段把 `base_branch` 合并进来 |
| current_plan_id | TEXT NULL | 当前生效（confirmed）版本（无外键：plans 引用 tasks，两张表不能互相引用，D43） |
| result | TEXT(JSON) NULL | 结果卡数据 `TaskResultDTO`：`{ summary, filesChanged, insertions, deletions, files[], checks[], nodeSummaries[], assumptions[] }`（`checks[]` 每项 `{ nodeKey, nodeTitle, kind, passed, command, skipped }`，`command` 只有命令检查有，`skipped` 为用户跳过的检查，D116）（进入 `review` 时生成） |
| created_at / updated_at / started_at / finished_at | INTEGER | |
| archived_at | INTEGER NULL | 归档时间（42，D218，迁移 `0033_task_archive`）；只有已结束的任务能归档，归档不改 `updated_at`；从 PR 审查意见回流重新打开时清空 |

索引：`(project_id, status)`、`(status, updated_at)`、`(archived_at)`。

删除任务（42，D221）：任务行删除，`ON DELETE CASCADE` 带走节点、尝试、计划、需求、交付、工作区记录、「需要你处理」、时间线、批次条目与助手的任务跟进；定时任务运行记录与需求计划工作包的 `task_id` 置空。属于批次或需求计划的任务不能删除（D222）。

### app_counters

只发放一次的编号（D223，迁移 `0033_task_archive`）。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| name | TEXT PK | `task_seq`：任务编号；迁移时取现有 `max(tasks.seq)` |
| value | INTEGER | 最后发出的编号；建任务时在同一条语句里加一并取回 |

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
| acceptance | TEXT(JSON) | 解析后的 `Acceptance`（`NodeAcceptance`），命令检查可含 `autoProject: true`，此时 `command` 保存冻结的备用命令，无备用时为 `$PROJECT_CHECK`。计划确认时冻结（13 §1；页面体检冻结 `pages` 与 `viewports`，项目没有预览时移除，29 §7.1）；用户可在任务失败后改写其中的命令检查，或给无法运行的命令检查、页面体检标 `skipped: true`（D116） |
| kind | TEXT | `normal` / `revise` |
| status | TEXT | `NodeStatus` |
| attempt_count | INTEGER | 消耗的预算 |
| retry_feedback | TEXT NULL | 下次尝试附带 |
| result | TEXT(JSON) NULL | 最近一次 `submit_result`，可附交接与服务端记录的尝试 ID 和提交 |
| check_results | TEXT(JSON) NULL | 当前这份结果的检查结果；交了新结果或重新检查（D116）进入 `verifying` 时置空，检查全部跑完后写入，所以检查中为 NULL（上次没通过的原因在 `retry_feedback`）。`CheckResult[]`：命令检查 `{ kind: command, command, passed, output, exitCode, timedOut, unrunnable, skipped }`（输出保留末尾 `ACCEPTANCE_OUTPUT_MAX_CHARS`；`unrunnable: { program, reason } | null` 为应用环境无法运行，`skipped` 为用户跳过、未运行且不挡住步骤（`passed` 为 true），D116；之前写入的行没有这两项，读出为 `null` / `false`）；AI 评审 `{ kind: ai_review, focus, passed, output, attemptId, issues[] }`；页面体检 `{ kind: browser, passed, pages: [{ path, viewport, httpStatus, errors, warnings, screenshot }], output, unrunnable: { reason, logTail } \| null, skipped }`（v1.3，29 §7.4） |
| commit_sha | TEXT NULL | |
| position | INTEGER | 画布与列表排序 |
| created_at / updated_at / started_at / finished_at | INTEGER | |

自动验收的命令结果可含 `autoSelection { source, configurations, reason }`，来源为 `idea` 或 `fallback`。未匹配到配置且备用命令为空时记录 `skipped: true`，结果卡会标明没有可运行的检查。旧记录继续按原格式读取。

索引：`(task_id, status)`。

### attempts

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| task_id | TEXT NULL → tasks，CASCADE | 空 = 调试尝试（仅开发构建，M2-09）、知识问答的 `research` 尝试（v1.1，由 `knowledge_turns` 指向）或 PPT 的 `deck_outline` / `deck_slides` 尝试（v1.2，由 `deck_runs` 指向），不属于任何任务 |
| node_id | TEXT NULL → nodes，CASCADE | `execute` 类为所执行的节点，`review` 类为被评审的节点；`plan` 类与调试尝试为空 |
| project_id | TEXT NULL → projects，SET NULL | 会话所在的项目：任务的尝试为任务的项目，知识问答为对话的项目，PPT 为其项目；调试尝试与不属于项目的 PPT 为空。续用会话的尝试沿用。权限条目的「总是允许」记到这个项目，新建会话带上项目的总是允许模式（D101；迁移 0014 按任务、知识对话与 PPT 补上） |
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

只读委派沿用 `attempts`，归属父步骤的任务及节点。对应 `task_events` 记父尝试 ID 和固定的 Git 提交，模型用量与会话流随子尝试保存。


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
| `permission` | `{ opencodePermissionId, sessionId, directory, permission, patterns[] }`（`patterns` 为询问的子命令原文；bash 请求选「总是允许」时由它们得出记到项目的模式，D101） | `{ decision: PermissionDecision }` |
| `acceptance` | `{}` | `{ accepted: boolean, feedback?: string }` |
| `plan` | `{ planId, version }` | `{ confirmed: true }` 或 `{ replanFeedback }` |
| `failure` | `{ phase, error }` | `{ action: 'retry' | 'cancel' }` |
| `delivery` | `{}` | `{ deliveryId }` |
| `schedule_failure`（v1.2） | `{ scheduleId, error }`（`task_id` 等为空，`title` 为定时任务标题） | `{ resumed: true }`（恢复定时任务时 resolved；删除定时任务或用户忽略时 dismissed，22 §5） |

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
| remote_ref | TEXT NULL | UX-09。PR / MR 交付时的平台、地址及仓库身份；旧记录可为空。 |
| remote_status / remote_error | TEXT NULL | UX-09。最近一次成功的远端状态快照及最近一次查询错误，失败时保留快照与其查询时间。 |
| diff_base / diff_head | TEXT NULL | UX-03。记录本次交付的固定对比范围。本地合并是目标分支交付前后的提交，PR / MR 是对比基线与本次推送提交。旧交付可为空 |
| conflict_files | TEXT(JSON) NULL | |
| error | TEXT(JSON) NULL | |
| created_at / finished_at | INTEGER | |

## 3. JSONL 会话流

运行目录 `runs/<taskId>/`（或 `runs/knowledge/` 等）里还有页面预览的输出 `preview.log` 与浏览器截图、动作画面及其索引 `browser/<attemptId>/`（`<n>.jpg`、`f<n>.jpg`、`frames.jsonl`）、页面体检截图 `browser/checks/`（v1.3，29 §4.2、§5.7），读会话流时只读 `*.jsonl`。

路径：`<数据目录>/runs/<taskId>/<attemptId>.jsonl`（调试尝试为 `runs/debug/<attemptId>.jsonl`，知识问答的 `research` 尝试为 `runs/knowledge/<attemptId>.jsonl`，PPT 的尝试为 `runs/ppt/<attemptId>.jsonl`）。每次尝试一个文件，只追加（同步追加，保持事件顺序），由尝试模块把 opencode 事件转换后写入，同时经 SSE 推送 `attempt.transcript` 事件。schema 为 `shared/contracts/api/attempts.ts` 的 `transcriptEntrySchema`。

每行：

```json
{ "seq": 12, "ts": 1760851200000, "kind": "tool_call", "data": { "tool": "edit", "callId": "call_...", "input": { "filePath": "src/a.ts" } } }
```

| kind | data |
| --- | --- |
| `user_message` | `{ text }`（我们发给会话的提示词 / 答案 / 提醒） |
| `text` | `{ text, offset }`，带 `partId`（模型正文；流式时同一 `partId` 多行，每行是**增量**：从第 `offset` 个字符起的新内容，每增长 `TRANSCRIPT_TEXT_FLUSH_CHARS` 写一次，片段结束时写余下部分（结束时的全文与已写的不同，从共同前缀之后写）；读取时按 seq 依次合并，`全文 = 全文.slice(0, offset) + text`（`mergePiece`，`shared/transcript/parts.ts`）。D104 之前的行没有 `offset`，是到当时为止的全文，读作 `offset` 0） |
| `reasoning` | 同 `text` |
| `tool_call` | `{ tool, callId, input }`（工具开始运行时一次） |
| `tool_result` | `{ tool, callId, status: 'completed' \| 'error', output?, error? }` |
| `file_edit` | `{ path, additions, deletions }`（预留，M2 未产生；编辑以 `tool_call` / `tool_result` 出现） |
| `permission` | `{ permissionId, permission, patterns }` |
| `system` | `{ event: TranscriptSystemEvent, detail? }`（尝试开始、已提醒、重试中、已提交、超时、已中止、运行时消失；文案在前端） |
| `error` | `ErrorInfo`（`{ code, message, details? }`；尝试结束后的会话错误不记录，如提交后我们发出的中止） |
| `confirmation` | `{ confirmationId }`（仅助手对话：一次等待用户确认的调用，卡片内容来自 `assistant_confirmations`） |
| `attachment` | `{ path, lost? }`（仅助手对话：助手写入对话文件目录 `files/<id>/` 的文件，`path` 相对该目录；从源文件写出的 Word / Excel 文件另有 `lost: [{ kind: OfficeLoss, count }]`，即新文件没有保留的内容，39 §7.2） |
| `entity_ref` | `{ kind: EntityKind, id, title }`（仅助手对话：助手调用的操作执行成功后产出的对象，界面渲染为导航卡片，D66） |
| `chart` | `{ chart: ChartSpec }`（仅助手对话：`show_chart` / `show_flowchart` 校验通过后的图，`shared/contracts/chart.ts`；只做向后兼容的修改，35 §4、D139） |

读取：`GET /attempts/:id/transcript?afterSeq=` 每页 `TRANSCRIPT_PAGE_SIZE` 行；seq 从 1 起逐行连续编号（第 i 行即 seq i+1），所以一页就是按行切出的一段，只解析这一段（M6-02：5 MB、约六千行的文件，每页约 20 ms）；页内同一 `partId` 的行合并为一条（`offset` 为第一行的、`text` 为合并后的增量，seq 与时间取最后一行），放在它首次出现的位置，后一页接着合并。界面先显示第一页，其余页在后台接着读；读页期间经 SSE 到达的行另存一处：各页连续覆盖 1…n 行，所以只取 seq 大于最后一页的实时行，按 seq 去重排序后接着合并（`transcriptEntries`），读页与追加交错时不丢行也不重复。

## 4. 助手（v1.1）

见 [15-assistant.md](15-assistant.md)，迁移 `0008`。

### assistant_browser_activity

助手网页操作记录。包含自增 `id`、`conversation_id`（对话删除时级联）、`record`（JSON）和时间 `at`。应用按对话保留最近 100 条，记录页面路径、动作、控件名称、结果和被拦截的请求地址。迁移 0046。

### assistant_conversations

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| title | TEXT | 默认取第一条消息的首行（`ASSISTANT_TITLE_MAX_CHARS`） |
| project_id | TEXT NULL | 迁移 0035；创建时验证，空值为通用对话。项目删除后保留原 ID 以区分通用会话 |
| opencode_session_id | TEXT NULL | 第一条消息时创建；MCP 调用归属的依据；已隔离会话运行于真实路径 `assistant/files/<id>/` |
| isolated | INTEGER boolean DEFAULT 0 | 迁移 0020：旧记录为 false，新建为 true；首次发送前把旧原生会话迁移到独立目录 |
| retired_session_id | TEXT NULL | 迁移 0020：等待清理的旧原生会话；持久化后才删除，失败保留供跨重启重试，禁止回到旧目录运行 |
| created_at / updated_at | INTEGER | `updated_at` 随每条消息更新，列表按它倒序 |

索引：`(opencode_session_id)`、`(updated_at)`。

### assistant_continuations

迁移 `0035_assistant_conversations`、`0036_continuation_attachments`。删除子对话时随它级联清理，删除来源时仍保留交接内容。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| conversation_id | TEXT PK → assistant_conversations，CASCADE | 新会话 |
| source_conversation_id | TEXT | 来源会话，删除来源后保留原 ID |
| request_id | TEXT UNIQUE | 界面为同一次操作生成的 UUID |
| cutoff_seq | INTEGER | 原消息流最后纳入的序号 |
| handoff_text | TEXT | 有长度上限的历史交接文字 |
| handoff_kind | TEXT | `summary` 为抽取要点与近期原文，`recent` 为仅有近期原文 |
| attachment_ids | TEXT(JSON) | 用户创建续接时选定的附件 ID，独立于消息发送后建立的附件引用 |
| draft_text | TEXT NULL | 明确上下文超限时恢复原用户输入，模型接受子对话首轮后清除 |
| created_at / consumed_at | INTEGER / INTEGER NULL | 创建与首轮交接接受时间 |

### assistant_memories

迁移 `0043_assistant_memory`。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT NULL → projects，CASCADE | 空值表示个人记忆；删除项目时级联删除项目记忆。 |
| content | TEXT | 经用户保存的记忆正文。 |
| source_conversation_id | TEXT NULL → assistant_conversations，SET NULL | 助手提议的来源对话；用户直接新增时为空。删除来源对话时保留记忆。 |
| updated_at | INTEGER | 新增、修改时更新；用于排序。 |

索引：`(project_id, updated_at)`。

### assistant_confirmations

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| conversation_id | TEXT → assistant_conversations，CASCADE | |
| operation_id | TEXT | 操作清单 id |
| input | TEXT(JSON) | 助手给出的参数（已按助手 schema 校验，不含凭据字段） |
| status | TEXT | `AssistantConfirmationStatus`（09 §10） |
| result | TEXT(JSON) NULL | 确认后：`{ ok: true, output }` 或 `{ ok: false, error }`；无返回值的成功操作用 `output: null`，读取旧版缺失 output 的成功记录时同样转为 null；取消为空 |
| created_at / resolved_at | INTEGER | |

索引：`(conversation_id, created_at)`。

### assistant_outbox

迁移 `0018_assistant_outbox`；保存尚未成功交给 opencode 的应用消息（确认结果、取消通知或普通任务状态回报）。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | 入队顺序 |
| conversation_id | TEXT → assistant_conversations，CASCADE | 删除对话时清理待发消息 |
| text | TEXT | 已渲染的结果消息 |
| created_at | INTEGER | 入队时间 |

索引：`(conversation_id, id)`。确认结果与入队在同一事务保存；取消状态与入队也在同一事务保存。按 id 顺序发送，只在发送成功后删除本次读取的消息，期间新入队的消息继续保留。断线、发送失败与后端重启不会丢失队列，待下一次发送时恢复；恢复只投递消息，不重新执行业务操作。若外部已接受消息而本地尚未删除队列时进程退出，恢复可能重复通知，不承诺跨进程的恰好一次投递。

### assistant_task_followups

迁移 `0019_assistant_task_followups`；仅登记通过助手 `tasks.create` 成功创建的普通任务，确认后执行与总是允许共用同一入口。任务与归属在同一事务插入，首次状态事件发布及任务启动前已提交；登记失败时整个创建回滚。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| task_id | TEXT PK → tasks，CASCADE | 一个任务只有一个原始对话 |
| conversation_id | TEXT → assistant_conversations，CASCADE | 删除原对话即停止跟进 |
| last_event_id | INTEGER DEFAULT 0 | 已消费的最新任务级 `task_events.id`，不是节点或进度事件 |
| created_at | INTEGER | 登记时间 |

索引：`(conversation_id)`。事件游标与 `assistant_outbox` 消息在同一事务提交，重复 SSE 不重复入队。启动时批量补扫最新真实状态；若停机间发生多个未消费状态，以当前状态为准，不把已经结束的失败重新呈现为当前失败。`review`、`failed`、`completed` 入队；其他状态只推进游标。已入队消息保留发生时间和事件编号，恢复只重投消息，不重新执行任务。删除任务会删除跟进记录；删除对话同时清理其跟进和 outbox。

消息流：`<数据目录>/assistant/conversations/<id>.jsonl`，格式同 §3（多 `confirmation`、`attachment`、`entity_ref` 三种条目）；记录用户的消息、模型的正文与工具调用、权限请求、错误；后端代发的确认结果消息与每轮注入的 `system` 不记录（卡片显示结果）。

### assistant_turns

助手在创建外部会话或发送消息前保存轮次，包含用户消息与应用回传消息。历史聊天不补造轮次或零用量；统计起点为本对话首条轮次的开始时间。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | 轮次顺序，同一时钟刻度也稳定 |
| conversation_id | TEXT → assistant_conversations，CASCADE | 删除对话时清理 |
| source | TEXT | `user` 或 `app`（确认结果等回传） |
| status / end_reason | TEXT / TEXT NULL | `AssistantTurnStatus` / `AssistantTurnEvent`，见 09 §14 |
| model | TEXT NULL | 本轮开始时的模型设置；空表示运行时默认 |
| started_at / ended_at | INTEGER / INTEGER NULL | 注入 Clock 的毫秒时间 |
| elapsed_ms | INTEGER NULL | 正常结束为墙钟耗时，含权限等待；后端重启发现的未结束轮次为未知，不能把离线时间算入 |
| tokens_input / tokens_output | INTEGER NULL | 实际 `StepFinished` 报告之和；未报告保持 NULL，实际报告零保留 0 |
| timeout_ms | INTEGER | 本轮开始时 `attempt.timeoutMinutes` 的快照 |
| message_ids / step_ids | TEXT(JSON string[]) | 将实际报告关联至原轮次，按 step part id 去重，重放与迟到报告不重复累计 |

索引：`(conversation_id, started_at)`、`(status)`。后端重启将遗留 `running` 转为 `interrupted / backend_restart`；运行时消失用 `runtime_lost`。用量可在轮次结束后通过已关联的 message id 补报，未知所属轮次的报告不猜测归属。

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

## 4b′. 需求计划（v1.3）

见 [34-initiatives.md §9、§15.8](34-initiatives.md)，迁移 `0026_initiatives`。需求计划没有状态列，显示状态由下列事实与工作包的任务推导（34 §6）；`breakdown_rev`、`confirmed_rev`、`opened_phase` 只增不减。资料附件为 `attachment_refs`（`owner_kind = initiative`），删除需求计划或项目时释放（项目删除经 `tasks.onProjectDeleted`）。

### assistant_breakdown_followups（34 §10）

助手发起的需求计划 AI 拆解（第一次拆解、重新拆解、细化）：结束后把结果送回发起它的对话，同 `assistant_analysis_followups`（33 §6）。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| attempt_id | TEXT PK | 这次拆解的尝试（`initiative_runs.attempt_id`） |
| initiative_id | TEXT → initiatives，CASCADE | 索引 |
| conversation_id | TEXT → assistant_conversations，CASCADE | |
| reported | INTEGER(bool) | 结果已排进对话，或用户在页面上开始了更新的一次（不再回报） |
| created_at | INTEGER | |

### initiative_templates

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| key | TEXT UNIQUE | 同流程 key 的规则 |
| kind | TEXT | `InitiativeTemplateKind`；内置模板每次启动就地重写，自定义模板由用户就地修改（34 §15.6），都不分版本 |
| name / description | TEXT | |
| position | INTEGER | 内置模板的列出顺序；自定义模板为 0，列在内置模板之后、按创建时间 |
| phases / items | TEXT(JSON) | `InitiativePhase[]` / `InitiativeItemSpec[]`（需求仍含 `{{requirement}}`） |
| created_at / updated_at | INTEGER | |

### initiatives

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| seq | INTEGER UNIQUE | 编号 `I-<seq>` |
| project_id | TEXT → projects，CASCADE | |
| template_id | TEXT NULL → initiative_templates，SET NULL | 来源，只用于页头 |
| base_branch | TEXT | 全部工作包的基础分支，也是合入的目标 |
| title / requirement | TEXT | 需求首行 / 需求原文 |
| phases | TEXT(JSON) | 创建时的快照：`[{ title, goal, autoOpen }]` |
| confirm_item_plans | INTEGER(bool) | 工作包任务的 `confirm_plan` |
| allowed_workflows | TEXT(JSON) NULL | AI 拆解可用的流程 key；NULL 为全部列出的流程（迁移 `0027_initiative_runs`） |
| summary / understanding / coverage | TEXT / TEXT(JSON) / TEXT(JSON)，都可空 | 最近一次 AI 拆解交上的说明、理解（范围、不做、假设、风险）与需求覆盖表 |
| breakdown_rev / confirmed_rev | INTEGER | `confirmed_rev < breakdown_rev` 即草稿待确认 |
| opened_phase | INTEGER | 已开启到第几阶段，0 为未开始 |
| created_at / updated_at | INTEGER | 索引 `(project_id, seq)` |

### initiative_items

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| initiative_id | TEXT → initiatives，CASCADE | UNIQUE(initiative_id, key) |
| key / title | TEXT | |
| ordinal | INTEGER | 写入的顺序 |
| phase | INTEGER | 从 1 起 |
| workflow_key | TEXT | 开始时用该流程的最新版本 |
| requirement | TEXT | 任务的需求（模板已替换） |
| depends_on / acceptance | TEXT(JSON) | 工作包 key / 验收清单项 |
| task_id | TEXT NULL → tasks，SET NULL | 当前任务；写入时 SQL 带 `WHERE task_id IS :读到的值`，两次开始只有一次成功；索引 |
| start_error | TEXT(JSON) NULL | 上一次开始失败的 `ErrorInfo`，成功时清空 |
| merge_confirmed_at / dropped_at | INTEGER NULL | 用户确认 PR 已合入 / 放弃的时间 |
| drop_reason | TEXT NULL | |
| created_at / updated_at | INTEGER | |

### initiative_item_tasks 与 initiative_coverage_versions

迁移 `0039`：`initiative_item_tasks(item_id, task_id, created_at)` 保存工作包每次启动的任务，`task_id` 唯一；替换当前任务时历史不删除。迁移将已有当前任务补入，无法恢复此前已经被覆盖的任务。`initiative_coverage_versions(initiative_id, revision, coverage, items, created_at)` 保存每次拆解的覆盖表及工作包 id、key、标题、验收项和当时任务关联快照，按需求计划与版本唯一。迁移保存已有的最新覆盖表和包身份；旧快照中没有保存的验收项详情及更早被覆盖的版本无法恢复。两表随所属工作包或需求计划删除。

覆盖表的显式验收链接在提交拆解时从包内 key 转为清单项 UUID；没有显式链接的旧数据只保留工作包级关系，不按文字或顺序推断。

### initiative_runs

一次 AI 拆解、重新拆解或细化（迁移 `0027_initiative_runs`）；状态不单独存，由尝试推导（同 `deck_runs`）。同一需求计划的各次 run 沿用同一个 opencode 会话。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| initiative_id | TEXT → initiatives，CASCADE | |
| seq | INTEGER | 需求计划内从 1 起 |
| attempt_id | TEXT → attempts | `AttemptKind.Breakdown`，会话流在 `runs/initiatives/` |
| mode | TEXT | `InitiativeRunMode` |
| instruction | TEXT NULL | 用户的意见 |
| open_phase | INTEGER NULL | 「进入第 k 阶段」选了先细化：确认这次的草稿时开启第 k 阶段 |
| created_at | INTEGER | 索引 `(initiative_id, seq)`、`(attempt_id)` |

删除需求计划或项目时，先删需求计划（run 随之级联），再删这些尝试。

## 4c. 定时任务（v1.2）

见 [22-scheduled-tasks.md §8](22-scheduled-tasks.md#8-数据模型迁移-0012_schedules)，迁移 `0012_schedules`。

### schedules

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects，CASCADE | |
| workflow_key | TEXT | 流程 key，无外键（每次运行取最新版本，D92） |
| title | TEXT | 需求首行 |
| requirement | TEXT | |
| base_branch | TEXT NULL | 空 = 运行时的项目默认分支 |
| frequency | TEXT(JSON) | `ScheduleFrequency` |
| status | TEXT | `ScheduleStatus`（09 §11） |
| next_run_at | INTEGER NULL | 暂停时为空 |
| created_at / updated_at | INTEGER | |

### schedule_runs

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| schedule_id | TEXT → schedules，CASCADE | 索引 `(schedule_id)` |
| trigger | TEXT | `ScheduleRunTrigger` |
| outcome | TEXT | `ScheduleRunOutcome` |
| due_at | INTEGER | 本次运行对应的计划时刻（手动为点击时刻） |
| missed | INTEGER | 折叠掉的更早的计划时刻数 |
| task_id | TEXT NULL → tasks，SET NULL | `started` 时开出的任务 |
| error | TEXT(JSON) NULL | `failed` 时的 `ErrorInfo` |
| created_at | INTEGER | 实际处理时刻；最新的运行按插入顺序（rowid）读取 |

## 4d. PPT（v1.2）

见 [23-ppt.md §3](23-ppt.md#3-数据模型)，迁移 `0013_decks`。PPT 没有状态列，显示状态由页面与最近一次 AI 工作的尝试推导（23 §4.3）。

### decks

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT NULL → projects，SET NULL | AI 可读其代码的项目；删除项目后 PPT 保留 |
| title | TEXT | 要求的首行，大纲返回后为 AI 给的标题（`title_edited` 时不再改） |
| title_edited | INTEGER(bool) | 用户改过名 |
| brief | TEXT | 要求原文 |
| slide_count_target | INTEGER NULL | 指定的页数；NULL = AI 决定 |
| theme | TEXT | `ThemeId`（D152 改名时由迁移 `0024_theme_ids` 换成新 ID；D154 删除 SPDB，迁移 `0025_drop_spdb_theme` 改为 `deepseek`） |
| understanding | TEXT(JSON) NULL | `DeckUnderstanding`，随大纲提交 |
| outline_confirmed_at | INTEGER NULL | 只写一次：之前为大纲阶段，之后为制作阶段 |
| created_at / updated_at | INTEGER | 列表按 `updated_at` 倒序 |

索引：`(project_id)`、`(updated_at)`。

### deck_materials

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| deck_id | TEXT → decks，CASCADE | |
| seq | INTEGER | |
| kind | TEXT | `DeckMaterialKind` |
| ref_id | TEXT NULL | 来源任务 / 知识对话 id，网页资料为读到的最终地址（不设外键，快照不随其删除） |
| artifact_version_id | TEXT NULL | 产物资料的来源版本，用于回查，不设外键 |
| title | TEXT | |
| content | TEXT | 创建时的快照（Markdown） |

### deck_slides

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| deck_id | TEXT → decks，CASCADE | |
| seq | INTEGER | 页序，从 1 起 |
| layout | TEXT | `SlideLayout`；做好后为内容的版式 |
| title | TEXT | 大纲标题 |
| points | TEXT(JSON) | 大纲要点 `string[]` |
| content | TEXT(JSON) NULL | `SlideContent`；NULL = 还没制作 |
| notes | TEXT | 讲稿 |
| previous | TEXT(JSON) NULL | AI 最近一次修改之前的 `{ content, notes }`（恢复上一版） |
| updated_at | INTEGER | |

索引：`(deck_id, seq)`。

### deck_runs

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| deck_id | TEXT → decks，CASCADE | |
| seq | INTEGER | PPT 内序号，从 1 起 |
| attempt_id | TEXT → attempts | 这次工作的尝试；类型（大纲 / 页面）、状态与模型由它推导 |
| targets | TEXT(JSON) | 目标页 id；大纲为空 |
| done | TEXT(JSON) | 已提交的目标页 id |
| instruction | TEXT NULL | 用户的意见或修改要求 |
| created_at | INTEGER | |

索引：`(deck_id, seq)`、`(attempt_id)`。

## 4e. Git 工作台（v1.2）

见 [27-git-workbench.md §7.2](27-git-workbench.md#72-数据10-增补)，迁移 `0015_git_workbench`（另给 `tasks` 加 `merge_source`）。

### git_reviews

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects，CASCADE | |
| target | TEXT | `GitReviewTarget` |
| label | TEXT | 分支名或短 SHA，显示用 |
| parent | INTEGER NULL | 提交的审查对比的是第几个父提交（从 1 起），重新审查按同一个父提交；其他对象为空 |
| from_sha | TEXT | 审查的 diff 的起点（工作区改动为 HEAD，提交为所选的父提交，分支与区间为 merge-base） |
| to_sha | TEXT NULL | 终点；空 = 主工作区的未提交改动 |
| focus | TEXT NULL | 用户填的关注点 |
| attempt_id | TEXT → attempts | `git_review` 尝试；审查的状态即它的状态，无状态列 |
| files | TEXT(JSON) | 开始时的改动文件清单 `DiffFile[]`，校验与界面都用它 |
| summary | TEXT NULL | `submit_findings` 的结论 |
| findings | TEXT(JSON) NULL | `GitFindingDTO[]` |
| created_at / finished_at | INTEGER | `finished_at` 在尝试结束（任何终态）时写入 |

索引：`(project_id, created_at)`、`(attempt_id)`。AI 草拟提交信息不存库（27 §7.3），只留下它的 `commit_message` 尝试。

## 4f. 团队（v1.3）

（助手侧另有 `assistant_analysis_followups`：`analysis_id` PK → team_analyses CASCADE、`conversation_id` → assistant_conversations CASCADE、`reported` INTEGER(bool)、`created_at`；助手发起的成员分析结束后把报告发回发起它的对话，33 §8.1。）


见 [33-team.md §7、§8.2](33-team.md#82-表10-增补迁移-0023_team)，迁移 `0023_team`。提交按 SHA 缓存，不会过期，也不记录「属于哪个分支」（可达集合每次用 `git rev-list` 现算，D129）。

### team_commits

| 列 | 类型 | 说明 |
| --- | --- | --- |
| project_id | TEXT → projects，CASCADE | 主键 `(project_id, sha)` |
| sha | TEXT | 不含合并提交 |
| author_email / author_name | TEXT | 已应用 `.mailmap`，邮箱小写 |
| authored_at | INTEGER | 作者时间 |
| subject | TEXT | 提交标题 |
| ai_task | INTEGER(bool) | 作者是 `GIT_COMMIT_IDENTITY`（本应用的任务提交） |
| ai_coauthor | INTEGER(bool) | 有其他 AI 工具的 `Co-Authored-By` |
| requested_by_email / requested_by_name | TEXT NULL | 发起人 trailer（D130） |
| reverts_sha | TEXT NULL | `This reverts commit <sha>` 的目标 |
| files | TEXT(JSON) | numstat：`[path, added, deleted][]`，改名记新路径，二进制文件的增删为 null；不单独成表（33 §7.1） |

索引：`(project_id, authored_at)`。

### team_identities

`(project_id → projects CASCADE, email)` 为主键；`member_email` TEXT NULL（合并到的主身份，只有一层）、`display_name` TEXT NULL、`hidden` INTEGER(bool)（设为非成员）。没有行的邮箱就是它自己这位成员。

### team_settings

`project_id` 主键 → projects CASCADE；`exclude_globs` / `test_globs` TEXT(JSON) NULL、`huge_commit_lines` INTEGER NULL；空 = 默认（33 §2.4）。

### team_analyses

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects，CASCADE | |
| member_email | TEXT | 发起时成员的主身份 |
| ref / ref_sha | TEXT | 分支与发起时它的最新提交 |
| period_from / period_to | TEXT | `YYYY-MM-DD` |
| status | TEXT | `TeamAnalysisStatus`，经 `teamAnalysisMachine`（09 §15） |
| commits | TEXT(JSON) | 成员在时间段内的提交 SHA，报告只能引用它们 |
| sample | TEXT(JSON) | 抽样评审的提交 `{ sha, subject, lines }[]` |
| attempt_id | TEXT NULL | 轮到它时的 `team_analysis` 尝试 |
| report | TEXT(JSON) NULL | `submit_member_analysis` 的输入 |
| error | TEXT(JSON) NULL | `ErrorInfo` |
| created_at / finished_at | INTEGER | |

索引：`(project_id, created_at)`、`(attempt_id)`。

## 5. 删除与清理

- 删除项目：要求无非终态任务、没有研究中的知识对话、没有进行中的 Git 审查；级联删除其任务及全部关联数据和 `runs/<taskId>` 目录，以及知识对话、其 `research` 尝试与会话流，以及批次（外键级联，20 §6）与定时任务及其运行记录（22 §8），以及 Git 审查与其 `git_review` 尝试，以及团队的提交缓存、身份、口径与成员分析（外键级联；`team_analysis` 尝试的 `project_id` 置空，会话流留在 `runs/team/`）。
- 删除定时任务：删除其运行记录，关闭其未处理的 `schedule_failure` 条目（dismissed）；开出的任务保留。
- 删除知识对话：要求没有研究中的一轮；删除轮次、其尝试（权限条目随之级联）与 `runs/knowledge/<attemptId>.jsonl`。
- 删除 PPT：要求没有进行中的 AI 工作（`DECK_BUSY`）；删除其尝试（会话流 `runs/ppt/<attemptId>.jsonl` 随之删除，权限条目级联），再删除 PPT（页面、资料、工作记录级联）。删除项目时 PPT 的 `project_id` 置空。
- 删除助手对话：先停止并删除底层 opencode 会话（含待清理旧会话），失败保留本地对话；成功后级联删除其确认，并删除 `assistant/conversations/<id>.jsonl` 与 `assistant/files/<id>/`。
- 任务终态后 worktree 删除，但任务、计划、节点、尝试、会话流保留（供回看）。
- 不做自动过期清理（v1）。设置页显示数据目录占用。

## 6. 待实施数据设计（30 / 31）

精简版设计，未生成迁移；实施时按当时的迁移顺序编号。

### 6.1 附件

| 表 | 关键字段／约束 |
| --- | --- |
| attachments | id、source、name（显示名）、size_bytes、origin JSON（快照来源见下文）、format（`AttachmentFormat`，默认 text）、meta JSON（Word / Excel 的 `OfficeMeta`）、created_at。索引为 created_at。原文件按 id 存在 `attachments/<id>/original`（迁移 0017）。PNG / JPEG 只增加 `format` 的值，原图保留在同一路径，`meta` 为 null。Word / Excel 另有模型读取的 `text.md`，Excel 还有单元格 `workbook.json`（迁移 0032，39 §5）。 |
| attachment_refs | owner_kind、owner_id、attachment_id FK、ordinal、created_at；主键 (owner_kind, owner_id, attachment_id)，索引 attachment_id |

项目文件的 `origin` 保存 `projectId`、`taskId`、相对路径、行范围和读取时间。知识问答的 `origin` 保存 `kind = knowledge_answer`、`projectId`、`conversationId`、`turnId`、`answeredAt` 和 `readAt`，旧附件仍按原格式解析。快照保存回答时选中的原文和引用，任务从附件归属读取，删除问答不会删除已绑定的快照。项目约定证据快照的 `origin` 保存 `kind = convention_evidence`、`projectId` 与 `readAt`；来源文本作为只读附件保存，任务绑定时检查项目归属。节点新产生的检查失败、无法运行、执行失败及拒绝事件在 payload 中保存检查类型与通过状态，不记录命令或输出；历史事件未保存的详情不能重建。

- 所有者在自己的事务里创建／删除引用：删除任务时删除该任务（task_input）与其节点（task_feedback）的引用；删除助手对话时删除 assistant_message 引用。多态 owner 没有外键，由所有者模块负责。
- 助手会话 JSONL 的用户消息增加可选 `attachments: [{ id, name }]`，只作展示。
- 清理：在一个事务里删除没有引用且创建超过 `ATTACHMENT_ORPHAN_TTL_MS` 的记录，提交后再删文件；绑定在事务里先确认记录存在再插入引用，因此不会与清理交错（30 §4）。删文件失败留下的、目录中没有记录的残留按年龄清理。

### 6.2 需求清单

| 表／字段 | 关键字段／约束 |
| --- | --- |
| requirement_revisions | id、task_id FK（级联）、seq、items JSON、created_at；UNIQUE(task_id, seq)；只追加。当前版本就是 seq 最大的一条，任务表不另存（迁移 0022，Q-01 已实现） |
| requirement_results | id、task_id FK（级联）、revision_id FK（级联）、item_id、source、conclusion、note、output（命令输出末尾，按既有输出上限截断）、node_id 可空（用户结论为 null，不设外键）、commit_sha、created_at；只追加，按插入顺序读取（同一毫秒的两条不靠时间区分）（表已建，写入在 Q-02 / Q-03） |
| 交付时的清单摘要（Q-03 已实现） | 不另加列：记在这次交付的时间线事件 `payload.requirements` 里（`RequirementsDeliverySummary`：revisionId、commitSha、逐项 id／标题／是否必需／显示状态）；没有清单的交付没有这个字段 |

items 每项：`id`（后端分配，同一项跨版本保留）、`title`、`expected`、`required`、`verification`（`{ kind: 'command', command }` / `{ kind: 'ai_review' }` / `{ kind: 'manual' }`）。核验节点的命令检查在节点 acceptance 中带 `requirementItemId`（Q-02 已实现）：核验节点按顺序运行全部检查，第 i 个检查结果对应第 i 个检查，节点完成时 `tasks` 据此写入命令项的结论（通过 → pass，失败 → fail，跳过或无法运行 → unverified），AI 项的结论来自它的 `submit_result.requirement_results`；提交号是核验节点完成时工作区的 HEAD。

删除任务时级联删除清单版本与结论。

### user_skills 与 project_skill_bindings

- `user_skills` 按 UUID 保存 `name`（唯一）、`description`、`source`（完整 SKILL.md）与 `version`（从 1 开始，内容有变化时递增）与 `assistant_enabled`（允许助手手动选用，默认开启）。
- `project_skill_bindings` 主键为 `(project_id, workflow_key, skill_id)`，按 `position` 保存选用顺序。`role_ids` 保存精确角色 ID 的 JSON 数组，null 适用于该流程全部角色。迁移 0042 为旧选用和绑定保留原范围。外键随项目或 Skill 删除级联清理。流程下线或角色删除时，同一事务清理所涉及的绑定。若最后一个显式绑定角色被删除，则解除该条绑定。
- 助手 JSONL 的 `user_message` 可选 `skills` 字段保存当轮选用的 `id`、`name`、`version`。

## 功能测试记录（v1.6）

迁移 0047 为任务保存测试目标、允许的写路径、用例附件及复测选定的提交。每个功能测试任务的用例版本、实际执行、带递增序号的事件及版本化报告存入 `functional_tests`。`test_followups` 按来源与目标任务关联修复、复测及执行编号，重复提交同一请求返回已有任务。旧任务的功能测试配置为空。

### functional_tests · 功能测试记录

| 列 | 类型 | 说明 |
| --- | --- | --- |
| task_id | TEXT PK、FK → tasks.id | 删除任务时级联删除 |
| snapshot | TEXT(JSON) | 用例编号和版本、环境、执行、递增序号的脱敏事件以及 Markdown 报告版本。一次写入和相应序号同事务提交，随任务删除。 |

同一任务内的执行标识唯一。原始用例版本、对应执行和报告保存至任务删除。复制复测用例和新任务的关联记录共用同一事务。应用启动时将未完成执行归为阻塞并记录需要核实的写入。

### 项目模块目录与运行记录（0048）

`project_module_catalogs` 以项目 ID 为主键，保存带分支、提交和发现时间的模块目录，以及模块默认配置 ID 与验证指纹。`project_module_runs` 按项目和运行 ID 保存检查或试启动记录，包括基线、指纹、启动和结束时间、就绪结果及日志尾部。每组模块、配置和运行种类保留最近八次。项目删除后两表级联清理；应用重启时，对未结束的试运行记录标记中断并回收遗留的工作树。

组合目录、成员、配置来源与计划保存在项目目录 JSON 中。任务只保存已解析的结构化启动计划与基线，运行记录保存每个成员实际观察到的地址、就绪状态、诊断和脱敏日志。失败步骤的服务编号、模块和日志摘录随执行证据保存。旧单模块记录可继续读取。

## 数据库调查

`database_investigations` 的每条记录属于一个项目，以及一个任务或助手会话。记录保存数据库连接 ID、授权指纹、问题、回答和历次查询证据。删除所属任务、会话、项目或连接会级联删除调查。项目连接表的 `grant_id` 区分解绑前后的两次授权。

`database_investigation_sessions` 将调查 ID 映射到 OpenCode 会话 ID。会话映射独立保存，使服务在删除业务记录或授权失效后仍能定位和清理运行时会话。

## 启动环境变量

`startup_environment` 保存变量名、用于去重的规范化名称及显示顺序。普通值保存在本行，密钥值保存为指向 `credentials` 的外键。替换配置时同步更新凭据引用，删除行时清除其专用凭据。

`opencode_headers` 按相同规则单独保存模型请求头，名称大小写不敏感，加密值引用 `opencode_header` 凭据。环境变量和请求头分别保存，允许两者同名。

## 对话和任务的审批配置

迁移 0053 为 `assistant_conversations` 和 `tasks` 增加 `permission_mode`，默认 `ask`。每个对象独立保存选择。普通执行尝试的 `attempts.permission_baseline` 保存创建时的规则，同一原生会话继续执行时沿用。既有 `ai.imageModel` 迁入图像处理员的空模型字段，已有角色选择优先。
