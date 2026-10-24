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
| `AttemptKind` | `plan`（规划会话）· `execute`（节点执行会话）· `review`（AI 评审验收会话）· `research`（知识问答的一轮，不属于任务，18 §5.2）· `deck_outline`（PPT 的大纲）· `deck_slides`（PPT 的若干页：制作或修改，23 §4；两者在同一个会话中，`continueSession` 可换 kind）· `git_review`（Git 工作台的 AI 审查，不属于任务，27 §4.3）· `commit_message`（AI 草拟提交信息，27 §7.3） |
| `AttemptStatus` | `starting` · `running` · `succeeded` · `failed` · `aborted` · `interrupted` |
| `PlanStatus` | `draft` · `confirmed` · `superseded` |
| `PlanSource` | `ai` · `template` · `user` |
| `CheckpointKey` | `confirm_plan`（运行前确认计划）· `accept_each_node`（每个节点人工验收）· `ask_on_uncertainty`（不确定时停下来问） |
| `AcceptanceCheckKind` | `command`（在 worktree 运行命令，退出码 0 为通过）· `browser`（页面体检：任务预览的关键页面按事实判定，不用模型，v1.3，29 §7）· `ai_review`（评审角色会话）；一个步骤的检查按 `CHECK_KIND_ORDER` 依次运行 |
| `CheckUnrunnableReason` | `not_found`（退出码 127，shell 找不到检查命令点名的程序）· `not_executable`（126，程序没有执行权限）：检查命令在应用环境里无法运行（D116，09 §3） |
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
| `WorkflowKind` | `builtin` · `custom` · `system` | 内置流程只读，可复制为自定义；`system` 只由应用自己发起（Git 工作台的合并任务 `system.merge_branch`，27 §3.6），不列出、不能复制、不能用于新建任务 |
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
| `ChangeRequestReason` | `user`（让 AI 再改改）· `conflict`（交给 AI 解决冲突）· `review`（按 PR 审查意见修改，21）；`request-changes` 的 `reason` 只接受前两个，`review` 只经 `review-feedback` 发起 |
| `ReviewCommentKind` | `thread`（未解决的审查讨论，通常在某个文件的某一行）· `general`（对话中的评论或审查总结）（21 §2.2） |
| `GitOperation` | `merge` · `rebase` · `cherry_pick` · `revert`：主工作区里用户没做完的操作（27 §5） |
| `GitMergeStrategy` | `merge`（合并提交）· `squash`（压缩为一个提交）：Git 工作台的合并方式（27 §3.5） |
| `GitReviewTarget` | `worktree` · `commit` · `branch` · `range`：AI 审查的对象（27 §4.2） |
| `FindingSeverity` | `blocker` · `major` · `minor` |
| `FindingCategory` | `correctness` · `security` · `performance` · `maintainability` · `tests` |
| `DiffSide` | `new` · `old`：审查问题的行号属于改动后还是改动前的版本 |

`LOCAL_MERGE_STRATEGIES`（`squash` / `merge` / `rebase`，即 `delivery.defaultStrategy` 的取值）与 `isLocalMerge` 在同一文件。

### 2.5 需要你处理（Inbox）

| 枚举 | 值 |
| --- | --- |
| `InboxKind` | `question` · `permission` · `acceptance` · `plan` · `failure` · `delivery` · `schedule_failure`（v1.2，定时任务到点没能开始任务，不属于任何任务，22 §5）；常量 `NON_BLOCKING_INBOX_KINDS`（`delivery`：做完、等合并的结果）与 `BLOCKING_INBOX_KINDS`（其余所有种类：卡住任务、等用户行动的条目，徽标只数它们）（D119） |
| `InboxStatus` | `open` · `resolved` · `dismissed` |
| `PermissionDecision` | `once` · `always` · `reject`（与 opencode 取值一致） |

### 2.6 系统与其他

| 枚举 | 值 |
| --- | --- |
| `RuntimeStatus` | `not_installed` · `version_mismatch` · `stopped` · `starting` · `ready` · `crashed` |
| `Platform` | `darwin` · `win32` · `linux`（运行应用的操作系统，17 §1） |
| `DbType` | `mysql` · `postgresql` · `opengauss`（openGauss / GaussDB）· `sqlserver` · `goldendb`（MySQL 协议）（v1.2，24 §1） |
| `CredentialKind` | `git_token` · `db_password` |
| `TranscriptEntryKind` | `user_message` · `text` · `reasoning` · `tool_call` · `tool_result` · `file_edit` · `permission` · `system` · `error` · `confirmation` · `attachment` · `entity_ref` · `chart`（后四种仅助手对话，10 §3；`chart` 见 35 §4） |
| `TranscriptSystemEvent` | `attempt_started` · `nudged` · `retrying` · `result_submitted` · `awaiting_input`（等待用户回答或授权）· `timed_out` · `aborted` · `runtime_lost` · `assistant_isolated`（旧助手会话切换到独立目录；`system` 会话流条目记录的事件，文案在前端） |
| `McpToolName` | 执行 MCP 工具名（12 §6）；`ATTEMPT_SUBMIT_TOOL` 为每种尝试的提交工具 |
| `BashPolicy` | `auto`（默认放行，禁止 Git 写操作）· `ask`（只读命令放行，其余询问） |
| `OperationRisk` | `read` · `write` · `critical`（操作清单风险等级，决定助手确认行为，见 15 §4） |
| `ServerEventType` | 见 [11-api.md §11](11-api.md#11-sse-事件) |

### 2.7 应用助手（v1.1，`enums/assistant.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `AssistantConfirmationStatus` | `pending` · `confirmed` · `cancelled` | 确认卡片（09 §10） |
| `AssistantTurnStatus` | `running` · `completed` · `aborted` · `failed` · `interrupted` · `timed_out` | 助手单轮运行状态（09 §14），用量未知与状态独立 |
| `AssistantTurnEvent` | `idle` · `abort` · `error` · `runtime_lost` · `backend_restart` · `timeout` | 助手轮次的结束原因，运行时丢失与后端重启分别保存 |
| `AssistantToolName` | `get_current_time` · `get_app_status` · `open_page` · `open_form` · `list_files` · `reveal_file` · `read_attachment` · `browser_read` · `show_chart` · `show_flowchart`（35） | 助手专用工具（15 §3）；其余工具由操作清单生成 |
| `AssistantPage` | `desktop`（桌宠来源，不带任务参数） · `home` · `tasks` · `task` · `task_preview`（任务页的预览页签，v1.3 B3，29 §2.6） · `node` · `inbox` · `projects` · `project` · `settings` · `git` · `git_project` · `workflows` · `workflow` · `roles` · `databases` · `tools` · `runtime` · `knowledge` · `knowledge_conversation` · `knowledge_history` · `insights` · `ppt` · `ppt_deck`（23 §9） · `batches` · `batch` · `schedules` · `schedule` · `environment`（28 §4） | 当前页面与 `open_page` 的目标；每个页面需要的参数为常量 `ASSISTANT_PAGE_PARAMS`（`taskId` / `nodeId` / `projectId` / `workflowKey` / `knowledgeConversationId` / `deckId` / `batchId` / `scheduleId`；PPT 工作台另可带选中的页 `slideId`） |
| `EntityKind` | `task` · `project` · `workflow` · `role` · `db_connection` · `knowledge_conversation` · `batch`（20 §8） · `schedule`（22 §10） · `deck`（23 §9） · `git_review`（27 §7.1） | 操作契约 `produces` 的对象类型（`enums/entity.ts`）；`entity_ref` 条目的 `kind`；`workflow` 的 id 为流程 key（D66） |
| `InputRef` | `EntityKind` 的全部取值 · `inbox_item` · `node`（同一输入中 `id` 所指任务的步骤） · `attempt` | 操作契约 `refs`：输入字段指向的对象（`enums/entity.ts`）；助手确认卡片据此把 id 显示为对象名称，标签为对象类型（D84）；`workflow` 字段可以是流程 id 或 key |
| `AssistantForm` | `tasks.create` · `projects.create` · `projects.setHosting` · `databases.create` · `databases.update` | `open_form` 能打开的表单，以其提交的操作命名（`ASSISTANT_FORM_OPERATION`）；预填值的 schema 为该操作的助手输入（不含凭据字段）的 partial |
| `ChartType` | `bar` · `line` · `pie` · `flow` | 助手画的图（35，D138）：前三种来自 `show_chart`，`flow` 来自 `show_flowchart`；会话流 `chart` 条目的 `chart.type` |
| `FlowNodeShape` | `step` · `decision` · `terminal` | 流程图节点：步骤（默认）/ 判断 / 开始结束（35 §3.2） |

### 2.8 知识问答（v1.1，`enums/knowledge.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `KnowledgeTurnStatus` | `researching` · `answered` · `stopped` · `failed` | 一轮的状态，由其 `research` 尝试的状态推导（`knowledgeTurnStatusOf`，18 §3），不存储 |
| `KnowledgeSourceKind` | `code` · `docs` · `database` · `web` | 资料范围与引用的来源类别；文件按 `classifySource(path)` 分为代码或文档（`KNOWLEDGE_DOC_DIRS`、`KNOWLEDGE_DOC_EXTENSIONS`） |
| `CitationType` | `file` · `database` · `web` | `submit_answer` 的引用类型（18 §6.1） |
| `SessionAgent` | `planner` · `executor` · `reviewer` · `researcher` · `slides_writer` · `code_reviewer` | 会话以哪个 agent 运行（`enums/workflow.ts`）；角色的基础类型 `RoleBaseAgent` 只有前三个；`slides_writer` 为 PPT 写作者（23 §7.1）；`code_reviewer` 为 Git 工作台的只读审查与草拟提交信息（27 §4.3） |

### 2.9 质量与用量（v1.1，`enums/insights.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `InsightsPeriod` | `today` · `week` · `last_7_days` · `last_30_days` · `custom` | 统计的时间段（19 §2.2）；`custom` 带 `from` / `to` 日期 |
| `InsightsDimension` | `project` · `workflow` · `role` · `model` · `kind` | 用量的拆分维度（19 §2.3） |
| `InsightsFailureKind` | `checks_failed` · `rejected` · `attempt_error` | 失败原因的类别（19 §2.4）；`attempt_error` 另带错误码 |
| `InsightsDrill` | `completed` · `cancelled` · `failed` · `first_pass_missed` · `retried` · `interrupted` · `review_duration` · `failure` · 以及 `InsightsDimension` 的五个值 | 页面钻取的指标（19 §3.2），写在地址 `?drill=` |

### 2.10 批量任务（v1.1，`enums/batch.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `BatchDeliveryOutcome` | `delivered` · `conflict` · `failed` | 批量交付中一个任务的结果（20 §5）：已合并或已完成 / 合并冲突 / 合并前检查、合并或完成失败；后两种任务停在 `review` |

批次没有状态枚举：进度由子任务的 `TaskDisplayGroup` 汇总（`batchCounts`），「待合并」由 `isBatchDeliverable` 判断（`shared/batch/batch.ts`，D85）。

### 2.11 定时任务（v1.2，`enums/schedule.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `ScheduleStatus` | `active` · `paused` | 启用 / 已暂停，状态机见 09 §11 |
| `ScheduleFrequencyKind` | `daily` · `weekly` · `hourly` | 三种预设频率（22 §2，D90） |
| `ScheduleRunTrigger` | `on_time` · `catch_up` · `manual` | 准时 / 补跑（晚于计划时刻超过 `SCHEDULE_CATCH_UP_AFTER_MS` 或折叠了错过的时刻）/ 立即运行一次 |
| `ScheduleRunOutcome` | `started` · `skipped` · `failed` | 开了任务 / 上一次的任务还没结束而跳过 / 没能开始任务（定时任务自动暂停，22 §5） |

`ServerEventType` 另有 `schedule.updated`（11 §11）。

### 2.12 PPT（v1.2，`enums/deck.ts`）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `DeckStatus` | `outlining` · `outline_ready` · `failed` · `generating` · `incomplete` · `ready` | PPT 的显示状态，由页面与最近一次 AI 工作的尝试状态推导（`deckStatusOf`，`shared/deck/status.ts`，23 §4.3），不存储 |
| `DeckRunKind` | `outline` · `slides` | 一次 AI 工作做什么，由其尝试的 kind 推导（`deckRunKindOf`） |
| `DeckMaterialKind` | `text` · `file` · `task` · `knowledge` · `web` | 创建时快照的资料（23 §2.3）；`web` 为按网站规则只读读取一次的网页（29 §2.8） |
| `SlideLayout` | `cover` · `section` · `bullets` · `two_column` · `cards` · `steps` · `stats` · `table` · `code` · `quote` | 内置版式（23 §5.1，D93）；每种版式的字段与字数上限为 `slideContentSchema`（`shared/contracts/deck/slide.ts`） |

`ServerEventType` 另有 `deck.updated`（11 §11）。

### 2.13 页面预览与浏览器（v1.3，`enums/browser.ts`，29）

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `PreviewState` | `stopped` · `starting` · `running` · `failed` | 任务 worktree 的页面预览，只在内存里，经 `previewMachine`（09 §12） |
| `BrowserSessionKind` | `user` · `attempt` · `check` · `site` | 标签页属于谁（29 §5.3） |
| `BrowserTabKind` | `preview` · `site` | 一次尝试的两个标签页：任务预览、网站 |
| `SiteAccess` | `read` · `interact` | 网站规则的权限：只读浏览（AI 标签页的写请求与 WebSocket 被拦下）、可操作（29 §5.4） |
| `ViewportPreset` | `desktop` · `tablet` · `mobile` | 视口预设，尺寸为 `VIEWPORT_SIZES` |
| `BrowserActionFailure` | `not_visible` · `covered` · `disabled` · `detached` · `not_focusable` | `BROWSER_ACTION_FAILED.details.reason`（29 §5.5） |
| `BrowserBlockReason` | `not_allowed` · `read_only` | main 拦下请求的原因（29 §5.4） |
| `PageCheckUnrunnable` | `preview_never_started` · `preview_not_configured` | 页面体检无法运行的原因（29 §7.4，D116 的同一套出口） |
| `PageCheckError` | `navigation` · `exception` · `console` · `request` | 让页面不通过的事实（29 §7.3） |
| `PageCheckWarning` | `request` · `blocked` · `a11y` · `overflow` · `unsettled` | 页面体检只提醒的事实（29 §7.3） |

网站规则 `siteRuleSchema`（`{ pattern, access }`，`*` 代表任意字符、整个主机名不区分大小写匹配）、`urlAccess(url, policy)`（预览来源 → 预览，否则第一条匹配的网站规则，都不是为 null）与 `blockReason(request, policy, readOnlyEnforced)` 在 `browser/policy.ts`，main 与后端共用。`ServerEventType` 另有 `preview.updated`、`browser.frame`、`browser.tab_updated`（11 §11）。

## 3. 状态 → 语气映射（`STATUS_TONE`）

`STATUS_TONE.task` / `.node` / `.attempt` / `.knowledgeTurn` / `.deck` / `.runtime` / `.taskDisplay` / `.schedule`（类型保证每个值都有映射，单测再校验一次）。`schedule`（v1.2）：`active` → `ok`，`paused` → `wait`。`knowledgeTurn`：`researching` → `run`，`answered` → `ok`，`stopped` → `idle`，`failed` → `danger`。`deck`（v1.2）：`outlining` / `generating` → `run`，`outline_ready` → `wait`，`incomplete` → `warn`，`failed` → `danger`，`ready` → `ok`。`runtime`：`ready` → `ok`，`starting` → `run`，`stopped` → `wait`，`not_installed` / `version_mismatch` / `crashed` → `danger`。

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
| `OPENCODE_AGENT_NAME` | `{ planner: 'aw-planner', executor: 'aw-executor', reviewer: 'aw-reviewer', researcher: 'aw-researcher', slides_writer: 'aw-slides' }` | 按 `SessionAgent`；`aw-researcher` 为知识研究员（v1.1，18 §5.1），`aw-slides` 为 PPT 写作者（v1.2，23 §7.1），`code_reviewer: 'aw-code-reviewer'` 为 Git 工作台的审查员（v1.2，27 §4.3） |
| `MCP_SERVER_NAME` | `agent-workflow` | 执行 MCP；opencode 中工具名为 `agent-workflow_<tool>` |
| `MCP_ASSISTANT_SERVER_NAME` | `agent-workflow-app` | 助手 MCP（v1.1）；opencode 中工具名为 `agent-workflow-app_<tool>` |
| `OPENCODE_COMPANION_AGENT` / `COMPANION_WHISPER_TIMEOUT_MS` / `COMPANION_WHISPER_MAX_CHARS` | `aw-companion` / `60000` / `120` | 独立无工具碎碎念与单次超时（32 §3.4） |
| `OPENCODE_ASSISTANT_AGENT` | `aw-assistant` | 助手的 agent（v1.1） |
| `TASK_KEY_PREFIX` | `T-` | 任务编号 `T-<自增>` |
| `BATCH_KEY_PREFIX` | `B-` | 批次编号 `B-<自增>`（20 §6） |
| `BATCH_TARGET_PLACEHOLDER` | `{{target}}` | 批次需求模板中唯一的占位符，替换为每个目标（`renderBatchRequirement`，20 §2） |
| `DB_DEFAULT_PORT` | `mysql` 3306 · `postgresql` 5432 · `opengauss` 5432 · `sqlserver` 1433 · `goldendb` 3306 | 连接表单按类型预填的端口（24 §2） |
| `DB_READ_ONLY_STATEMENTS` | `mysql` / `goldendb`：SELECT SHOW DESCRIBE DESC EXPLAIN · `postgresql` / `opengauss`：SELECT SHOW EXPLAIN · `sqlserver`：SELECT | `db_query` 按连接类型允许的首关键字（24 §4）；语句检查、MCP 工具说明与界面文案都从它生成（`readOnlyStatementGroups`） |
| `BRANCH_PREFIX` | `aw/` | 分支名 `aw/<taskKey>-<slug>` |
| `BRANCH_SLUG_MAX` | `40` | slug 由标题转写，只保留 `[a-z0-9-]`（`toSlug`，`shared/naming.ts`） |
| `PROJECT_SLUG_MAX` | `40` | 项目 slug（worktree 目录名）由名称转写；无 ASCII 字符时为 `project`，重名追加 `-2`、`-3` |
| `API_PREFIX` | `/api/v1` | |
| `DEV_API_PORT` / `DEV_WEB_PORT` | `47821` / `47822` | 仅开发；生产后端随机端口（D31）。环境变量 `AW_DEV_API_PORT` / `AW_DEV_WEB_PORT`（`DEV_PORT_ENV`）覆盖，经 `devPorts(env)` 读取；浏览器 E2E 默认由系统分配（D78） |
| `MCP_EXEC_PATH` | `/mcp/exec` | |
| `MCP_ASSISTANT_PATH` | `/mcp/assistant` | v1.1 |
| `ASSISTANT_DIR` / `ASSISTANT_FILES_DIR` / `ASSISTANT_CONVERSATIONS_DIR` | `assistant` / `files` / `conversations` | 助手会话工作目录 `<数据目录>/assistant/files/<id>/`，对话文件相对该目录，消息流 `conversations/<id>.jsonl` |
| `KNOWLEDGE_DOC_DIRS` / `KNOWLEDGE_DOC_EXTENSIONS` | `docs` `doc` / `.md` `.mdx` `.markdown` `.txt` `.rst` `.adoc` | 被引用的文件位于这些目录下或带这些扩展名时为文档，否则为代码（18 §6.1） |
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
| `readonlyBashRules(checkCommands, allowedBash)` | 函数 | 规划与评审会话的会话级 bash 规则，`ask` 策略即不带检查命令的这一套；`allowedBash` 为项目中总是允许的模式（12 §2，D64、D100、D101） |
| `BASH_PERMISSION` | `bash` | opencode 中 shell 命令的权限类型 |
| `projectBashPatterns(commands)` | 函数 | bash 请求的「总是允许」中记到项目的模式：每条子命令的程序与开头的选项（到第一个不以 `-` 开头的参数为止）加 ` *`，去重；Git 与前置变量赋值的不记（D101） |
| `VIEWPORT_SIZES` | 桌面 1280×800、平板 768×1024、手机 390×844（后两者为移动设备） | 视口预设的 CSS 像素，一律经设备指标设置，DPR 为 1（29 §5.2） |
| `PAGE_CHECK_VIEWPORTS` | `desktop`、`mobile` | 页面体检没写视口时用的视口（29 §7.1） |
| `CHECK_KIND_ORDER` | `command` → `browser` → `ai_review` | 一个步骤的检查按这个顺序运行（29 §7.2） |
| `BROWSER_KEYS` | `Enter` `Escape` `Tab` `Backspace` `Delete` `Space` 四个方向键 `Home` `End` `PageUp` `PageDown` | `browser_press` 接受的按键 |

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
| `TRANSCRIPT_TEXT_FLUSH_CHARS` | 32（流式正文与思考每增长这么多字符写一行增量，D104） |
| `REPORT_PROGRESS_MAX_CHARS` | 200 |
| `RESULT_SUMMARY_MAX_CHARS` | 4000 |
| `SSE_REPLAY_BUFFER` | 1000（条） |
| `DIFF_FILE_MAX_BYTES` | 1048576（超过显示「文件过大」） |
| `INSIGHTS_MAX_DAYS` | 366（质量与用量自定义时间段最多天数） |
| `RUNTIME_LOG_TAIL_DEFAULT` / `RUNTIME_LOG_TAIL_MAX` | 500 / 5000（运行环境日志页的行数） |
| `LIST_PAGE_DEFAULT` / `LIST_PAGE_MAX` | 50 / 100（任务与「需要你处理」列表每页条数，11 §1） |
| `BATCH_TARGETS_MAX` | 20（一个批次的目标数，D85） |
| `BATCH_TARGET_MAX_CHARS` | 500（一个目标，单行） |
| `SCHEDULE_CHECK_INTERVAL_MS` | 60 000（定时器最长等这么久就检查一次到期的定时任务，22 §4） |
| `SCHEDULE_CATCH_UP_AFTER_MS` | 300 000（晚于计划时刻超过它即为补跑） |
| `SCHEDULE_RUNS_SHOWN` | 20（定时任务页列出的最近运行数） |
| `SCHEDULE_EVERY_HOURS` | `[1, 2, 3, 4, 6, 8, 12]`（`hourly` 可选的间隔，24 的约数，D90） |
| `ASSISTANT_TITLE_MAX_CHARS` | 40（助手对话标题取第一条消息的首行） |
| `ASSISTANT_MESSAGE_MAX_CHARS` | 20000（一条发给助手的消息） |
| `CHART_TITLE_MAX_CHARS` / `CHART_LABEL_MAX_CHARS` / `CHART_CAPTION_MAX_CHARS` / `CHART_UNIT_MAX_CHARS` | 60 / 40 / 200 / 8（助手画图的标题、类别 / 系列 / 节点标签、口径说明、单位，35 §3） |
| `CHART_SERIES_MAX` | 6（`bar` / `line` 的系列数；`pie` 恰好 1） |
| `CHART_CATEGORIES` | `bar` 1–31、`line` 2–90、`pie` 1–8 |
| `FLOWCHART_NODES_MAX` / `FLOWCHART_EDGES_MAX` / `FLOWCHART_NODE_ID_MAX_CHARS` / `FLOWCHART_EDGE_LABEL_MAX_CHARS` | 24 / 48 / 32 / 16 |
| `ASSISTANT_CONTEXT_MAX_CHARS` | 12000（一次显式附加的选中文字；任务／步骤快照正文超长时注明截断） |
| `KNOWLEDGE_QUESTION_MAX_CHARS` | 4000（一次提问） |
| `KNOWLEDGE_TITLE_MAX_CHARS` | 80（知识对话标题取第一次提问的首行） |
| `KNOWLEDGE_ANSWER_MAX_CHARS` | 20000（`submit_answer` 的回答） |
| `KNOWLEDGE_MAX_CITATIONS` | 20（一次回答的引用数） |
| `KNOWLEDGE_CITATION_MAX_LINES` | 200（一处文件引用的行数） |
| `KNOWLEDGE_EXCERPT_MAX_CHARS` | 4000（与文件引用一起保存的被引用行） |
| `KNOWLEDGE_SOURCE_CONTEXT_LINES` | 40（原文面板中引用区间前后各显示的行数） |
| `KNOWLEDGE_QUERY_ROWS` | 50（打开数据库引用时重新执行查询返回的行数） |
| `KNOWLEDGE_ANSWER_EXCERPT_CHARS` | 160（对话记录中最后一轮回答的摘要） |
| `COMMIT_MESSAGE_MAX_CHARS` | 10000（提交信息，27 §3.2） |
| `GIT_PUSH_COMMITS_SHOWN` | 20（推送确认列出的提交） |
| `GIT_REVIEW_FOCUS_MAX_CHARS` | 200（审查的关注点） |
| `GIT_REVIEW_FINDINGS_MAX` | 50（一次审查的问题数，27 §4.4） |
| `GIT_REVIEW_SUMMARY_MAX_CHARS` / `GIT_REVIEW_FINDING_TITLE_MAX_CHARS` / `GIT_REVIEW_FINDING_TEXT_MAX_CHARS` | 2000 / 120 / 2000 |
| `COMMIT_DRAFT_DIFF_MAX_BYTES` | 60000（草拟提交信息时交给 AI 的 diff，27 §7.3） |
| `COMMIT_DRAFT_TIMEOUT_MS` | 120000（草拟超时即中止，请求返回 `COMMIT_DRAFT_FAILED`） |
| `DECK_BRIEF_MAX_CHARS` | 4000（PPT 的要求） |
| `DECK_TITLE_MAX_CHARS` | 60（PPT 标题；创建时取要求的首行，大纲返回后用 AI 给的标题） |
| `DECK_MATERIALS_MAX` | 10（一份 PPT 的资料数） |
| `DECK_MATERIALS_MAX_CHARS` | 60000（全部资料快照的总字数，随首条消息发送，23 §7.2） |
| `DECK_INSTRUCTION_MAX_CHARS` | 2000（按意见重写大纲、让 AI 改的要求） |
| `DECK_MAX_SLIDES` | 30（一份 PPT 的页数） |
| `DECK_AUTO_SLIDES_MIN` / `DECK_AUTO_SLIDES_MAX` | 5 / 12（「让 AI 决定」页数时的范围，写在给 AI 的消息里） |
| `SLIDE_POINTS_MAX` / `SLIDE_POINT_MAX_CHARS` | 6 / 120（大纲一页的要点） |
| `SLIDE_NOTES_MAX_CHARS` | 1000（一页的讲稿） |
| `SLIDE_TEXT_LIMITS` | 各版式字段的字数与条数上限（标题 40、要点每条 60 至多 6 条、卡片 2–4 张、步骤 2–6 步、表格 2–5 列 1–8 行、代码 16 行每行 80 字……），按 1280×720 画布与最小字号定；`submit_slide` 与手动修改共用（`slideContentSchema`） |
| `SLIDE_FIT_MIN_SCALE` | 0.8（文字放不下时先缩到的最小比例，之后提示「文字可能放不下」，23 §5.4） |
| `PREVIEW_START_TIMEOUT_MS` / `PREVIEW_PROBE_INTERVAL_MS` | 120000 / 1000（页面预览就绪的时限与探测间隔，29 §4.2） |
| `PREVIEW_SETUP_TIMEOUT_MS` | 600000（worktree 第一次启动前的安装命令） |
| `PREVIEW_LOG_TAIL_CHARS` | 4000（预览起不来时保留的日志末尾） |
| `PREVIEW_PAGES_MAX` | 10（项目预览配置的关键页面数） |
| `BROWSER_ACTION_TIMEOUT_MS` | 5000（等目标可以点中，29 §5.5） |
| `BROWSER_READ_TIMEOUT_MS` | 30000（助手文字读取与用户导航的整体截止；临时/新页超时关闭，已有用户页保留） |
| `BROWSER_SETTLE_QUIET_MS` / `BROWSER_SETTLE_TIMEOUT_MS` | 500 / 10000（动作后等页面稳定：请求清零、DOM 无变动各持续多久，最多等多久） |
| `BROWSER_WAIT_FOR_MAX_MS` | 10000（`browser_wait_for` 最长等待） |
| `BROWSER_SNAPSHOT_MAX_CHARS` | 12000（页面快照的长度上限，29 §5.6） |

### 4.3 用户设置（`constants/settings.ts`，键 → 默认值）

| 键 | 默认 | 模式 |
| --- | --- | --- |
| `ui.mode` | `simple` | 简单 |
| `ui.theme` | `system` | 简单 |
| `ui.introAnimation` | `true`（打开动画，下次启动生效；main 经 `launch.json` 读它，28 §5.3） | 简单 |
| `ai.askOnUncertainty` | `false` | 简单 |
| `ai.defaultModel` | `null`（使用 opencode 默认模型） | 专业 |
| `ai.bashPolicy` | `auto`（助手不能修改，D65） | 专业 |
| `scheduler.maxConcurrentAttempts` | `4` | 简单 |
| `scheduler.maxConcurrentNodesPerTask` | `2` | 专业 |
| `node.maxAttempts` | `3` | 专业 |
| `attempt.timeoutMinutes` | `60` | 专业；任务尝试与助手单轮时限。助手权限等待暂停计时，回复后继续剩余时长，超时停止且不自动重试 |
| `worktree.rootDir` | `null`（使用 `<数据目录>/worktrees`；助手不能修改，D65） | 专业 |
| `delivery.defaultStrategy` | `squash`（可选 `squash` / `merge` / `rebase`；PR 有单独按钮） | 专业 |
| `delivery.deleteBranchAfterMerge` | `true` | 专业 |
| `opencode.binaryPath` | `null`（从 PATH 与 `~/.opencode/bin` 查找；助手不能修改，D65） | 专业 |
| `assistant.alwaysAllow` | `[]`（操作 id 列表；只有 write 级生效，critical 即使在列表中也每次确认；助手自己不能修改，D65；v1.1） | 简单 |
| `companion.appearance` | `orb`（`CompanionAppearance`：`orb` / `whale`，默认极光光球；32 §3） | 简单 |
| `companion.enabled` | `false`（桌面显示助手） | 简单 |
| `companion.animations` | `true`（系统减少动态效果仍优先） | 简单 |
| `companion.size` | `180`（整数 120–300） | 简单 |
| `companion.whisper` | `false`（自动碎碎念） | 简单 |
| `companion.whisperMinutes` | `15`（整数 1–120 分钟） | 简单 |
| `companion.notifications` | `true`（后台系统通知；应用内提醒独立显示） | 简单 |
| `preview.maxRunning` | `3`（同时运行的页面预览，29 §4.4） | 专业 |
| `preview.idleMinutes` | `10`（没有标签页、没有活动尝试多久后停止预览） | 专业 |
| `browser.sites` | `[{ pattern: '*', access: 'read' }]`（网站规则，按顺序取第一条匹配，无匹配不允许；助手不能修改，D65 的同一思路，29 §5.4） | 简单 |
| `browser.loginUrlPatterns` | `[]`（内置规则之外识别登录页的主机或路径片段） | 专业 |

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
| `WORKTREE_DIRTY` | 409 | 合并前 worktree 有未提交改动（正常流程由后端自动提交，出现即缺陷或用户手动改动）；Git 工作台切换分支、拉取与在检出的目标上合并时主工作区有改动（`details: { path, files }`，27 §3） |
| `GIT_NOTHING_TO_COMMIT` | 409 | 没有已暂存的改动（27 §3.2） |
| `GIT_IDENTITY_MISSING` | 400 | git 没有 `user.name` / `user.email`，无法以用户身份提交 |
| `GIT_OPERATION_IN_PROGRESS` | 409 | 主工作区有未完成的合并 / 变基 / cherry-pick / revert；`details: { operation, path }` |
| `GIT_PUSH_REJECTED` | 409 | 远端分支有本地没有的提交，推送被拒（不强推）；`details: { branch }` |
| `GIT_NO_UPSTREAM` | 409 | 当前分支没有上游，不能拉取 |
| `GIT_BRANCH_EXISTS` | 409 | 同名本地分支已存在 |
| `GIT_BRANCH_IN_USE` | 409 | 分支是默认分支或检出在某个工作区，不能删除或切换到它；`details: { branch, path }` |
| `GIT_BRANCH_NOT_MERGED` | 409 | 删除未合并的分支要 `force` |
| `GIT_BRANCH_OWNED_BY_TASK` | 409 | 分支属于没结束的任务，只能在任务页交付；`details: { branch, task: { id, key } }`（27 §5） |
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
| `NODE_ATTEMPTS_EXHAUSTED` | — | 节点用完重试预算仍未通过（记录在任务的 `failure` 上，不作为 HTTP 错误）；`details: { nodeKey, nodeTitle, feedback, command }`，`command` 为最近一次已提交结果未通过的命令检查（可「修改检查命令」，D116），失败在尝试本身或 AI 评审时为 `null` |
| `BROWSER_CHECK_UNRUNNABLE` | — | 节点的页面体检在应用环境里无法运行（预览从没启动过或配置已删除，29 §7.4；同 `CHECK_COMMAND_UNRUNNABLE` 记录在任务的 `failure` 上，不消耗预算）；`details: { nodeKey, nodeTitle, reason, logTail }`，`reason` 为 `PageCheckUnrunnable` |
| `CHECK_COMMAND_UNRUNNABLE` | — | 节点的检查命令在应用环境里无法运行（D116，记录在任务的 `failure` 上，不作为 HTTP 错误，不消耗预算）；`details: { nodeKey, nodeTitle, command, program, reason }`，`reason` 为 `CheckUnrunnableReason` |
| **尝试 / opencode** | | |
| `ATTEMPT_NOT_FOUND` | 404 | |
| `ATTEMPT_NO_RESULT` | — | 会话结束但未提交结果（记录在尝试上，不作为 HTTP 错误） |
| `ATTEMPT_TIMEOUT` | — | 超过 `attempt.timeoutMinutes` |
| `ATTEMPT_SESSION_ERROR` | — | opencode `session.error`；`details` 为原始错误 |
| `OPENCODE_NOT_READY` | 503 | 运行时不是 `ready` |
| `OPENCODE_REQUEST_FAILED` | 502 | 调 opencode API 失败 |
| `PERMISSION_REQUEST_EXPIRED` | 409 | opencode 明确返回该权限请求不存在；移除对应残留卡片，不视为已批准 |
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
| `ASSISTANT_CONTEXT_CHANGED` | 409 | 关联等待期间当前预览或对话已切换；该消息尚未发送，保留草稿供用户确认后重试 |
| **批量任务（v1.1）** | | |
| `BATCH_NOT_FOUND` | 404 | 批次不存在（所属项目已删除时随之删除） |
| **定时任务（v1.2）** | | |
| `SCHEDULE_NOT_FOUND` | 404 | 定时任务不存在（已删除，或所属项目已删除） |
| `SCHEDULE_BUSY` | 409 | 「立即运行一次」时上一次开出的任务还没结束（22 §7） |
| **知识问答（v1.1）** | | |
| `KNOWLEDGE_CONVERSATION_NOT_FOUND` | 404 | |
| `KNOWLEDGE_CONVERSATION_BUSY` | 409 | 对话还有一轮在研究时又续问、删除对话，或删除其项目 |
| `KNOWLEDGE_CITATION_INVALID` | — | MCP `submit_answer`：引用校验失败；`details.problems[]`，每项 `{ code, citation?, message, hint, details? }`，子码见 5.5 |
| `KNOWLEDGE_CITATION_NOT_FOUND` | 404 | 轮次不存在，或编号超出这一轮的引用数 |
| `KNOWLEDGE_SOURCE_UNAVAILABLE` | 404 | 被引用的文件已不存在或已不在项目仓库内 |
| **PPT（v1.2）** | | |
| `DECK_NOT_FOUND` | 404 | |
| `DECK_SLIDE_NOT_FOUND` | 404 | 页面不存在或不属于这份 PPT |
| `DECK_BUSY` | 409 | 有 AI 工作进行中时又修改页面、发起 AI 工作或删除 PPT（先等它完成或停止） |
| **Inbox** | | |
| `INBOX_ITEM_NOT_FOUND` | 404 | |
| `INBOX_ITEM_CLOSED` | 409 | 条目已处理 |
| **交付** | | |
| `DELIVERY_CONFLICT` | 409 | 合并冲突；`details.files[]`（记录在冲突的 delivery 的 `error` 上，`deliver` 本身返回任务 DTO） |
| `DELIVERY_TARGET_NOT_FOUND` | 400 | 目标分支不存在 |
| `DELIVERY_TARGET_DIRTY` | 409 | 目标分支检出在某个工作区（通常是用户的主工作区）且有未提交改动，拒绝合并；`details: { path, branch, files[] }` |
| `DELIVERY_INTERRUPTED` | — | 应用在交付过程中退出（记录在 delivery 上，重启后任务回到 `review`） |
| **PR 审查意见回流（21）** | | |
| `PULL_REQUEST_NOT_OPEN` | 409 | 任务没有以 PR 交付，或它的 PR/MR 已合并或关闭；`details: { taskId, branch? }` |
| `BRANCH_DIVERGED` | 409 | 本地分支与远端分支各有对方没有的提交（PR 审查意见回流、Git 工作台的拉取），不做任何改动；`details: { branch }` |
| `GIT_REVIEW_NOT_FOUND` | 404 | Git 工作台的审查不存在（27 §7.1） |
| `GIT_REVIEW_RUNNING` | 409 | 同一项目已有进行中的审查；删除项目时也会因此拒绝 |
| `GIT_REVIEW_FINDINGS_INVALID` | — | `submit_findings` 的问题与审查的 diff 不符；`details.problems[]`（§5.6）与 `files` |
| `COMMIT_DRAFT_FAILED` | 502 | AI 没有草拟出提交信息（会话失败、超时或没有调用 `submit_commit_message`） |
| **数据库** | | |
| `DB_CONNECTION_NOT_FOUND` | 404 | 不存在，或（MCP 工具）不是任务项目关联的连接 |
| `DB_CONNECTION_ALREADY_EXISTS` | 409 | 连接名称已被使用（MCP 工具按名称找连接） |
| `DB_CONNECTION_FAILED` | 502 | `details.driverMessage` |
| `DB_QUERY_REJECTED` | 400 | 非只读语句（按连接类型的方言检查，24 §4） |
| `DB_QUERY_TIMEOUT` | 504 | |
| `DB_QUERY_FAILED` | 400 | SQL 错误；`details.driverMessage` |
| **凭据** | | |
| `CREDENTIAL_UNAVAILABLE` | 500 | safeStorage 不可用或解密失败 |
| `PREVIEW_NOT_CONFIGURED` | 409 | 项目没有页面预览配置（29 §4.1）；浏览器工具打开预览路径时同此码 |
| `PREVIEW_START_FAILED` | 502 | 页面预览没能就绪（进程退出或超时）；`details: { logTail }` |
| `PREVIEW_LIMIT_REACHED` | 409 | 同时运行的预览已达 `preview.maxRunning`，且都有标签页在用（29 §4.4）；`details: { maxRunning, taskIds }`，`taskIds` 为占用中的任务 |
| `BROWSER_SITE_NOT_ALLOWED` | 403 | 地址既不是任务预览，也没有网站规则允许（29 §5.4）；`details: { host }` |
| `BROWSER_NOT_OPEN` | 409 | 当前助手对话没有由界面绑定的用户预览；预览已停止、关闭、任务结束或读取期间切换关联时同此码（29 §9） |
| `BROWSER_LOGIN_REQUIRED` | 409 | 打开网站后到了登录页；`details: { url }`（登录页地址） |
| `BROWSER_READ_FAILED` | 502 | 助手网页导航失败（含重定向被网站规则拦截）或整体读取超时；`details: { url, reason, timeoutMs? }`，reason 为浏览器返回的加载错误，或超时的 `timeout`（携带 timeoutMs） |
| `BROWSER_REF_STALE` | — | 元素编号已作废（页面导航过），先重新读取快照；仅 MCP |
| `BROWSER_ACTION_FAILED` | — | 动作没能完成；`details: { reason, coveredBy? }`，`reason` 为 `BrowserActionFailure`；仅 MCP |

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

枚举 `WorkflowProblemCode`（`shared/errors/workflow-problems.ts`）；校验函数 `validateWorkflowDefinition({ planning, definition }, roles)` 位于 `shared/workflow`，流程编排器与后端（`POST /workflows/validate`、新建、修改）共用。每项带 `field`（`allowedRoles` / `plannerRole` / `template` / `requiredSteps`）。固定流程的模板按 5.3 的计划校验（允许角色为流程的 `allowedRoles`，无必经步骤），必经步骤检查重复 key（`DUPLICATE_KEY`）、角色是否允许（`UNKNOWN_ROLE`）、指令长度（`INSTRUCTIONS_TOO_LONG`）、最先与最后的步骤各至多一个（`REQUIRED_STEP_ORDER`：两个最先的步骤都要排在对方之前，没有计划能满足），这些沿用 5.3 的子码。

| 子码 | 含义 |
| --- | --- |
| `NO_ALLOWED_ROLES` | 允许的角色为空 |
| `ROLE_NOT_FOUND` | 允许列表或规划者中的角色不存在；`details.role` |
| `MISSING_PLANNER` | AI 规划流程没有规划者角色 |
| `PLANNER_ROLE_INVALID` | 规划者角色的 `base_agent` 不是 `planner` |
| `MISSING_TEMPLATE` | 固定流程没有模板 |

### 5.5 引用校验子码（`KNOWLEDGE_CITATION_INVALID.details.problems[].code`）

枚举 `CitationProblemCode`，hint 为常量 `CITATION_PROBLEM_HINT`（英文，给模型看），均在 `shared/errors/citation-problems.ts`；各子码的含义与 hint 见 [18 §6.2](18-knowledge.md#62-校验knowledge_citation_invaliddetailsproblems)：`OUTSIDE_PROJECT` · `FILE_NOT_FOUND` · `LINE_OUT_OF_RANGE` · `RANGE_TOO_LONG` · `SOURCE_NOT_SELECTED` · `UNKNOWN_CONNECTION` · `QUERY_NOT_READONLY` · `UNKNOWN_MARKER` · `UNUSED_CITATION`。

### 5.6 审查问题校验子码（`GIT_REVIEW_FINDINGS_INVALID.details.problems[].code`）

枚举 `FindingProblemCode`，hint 为常量 `FINDING_PROBLEM_HINT`（英文，给模型看），在 `shared/errors/finding-problems.ts`；每项带 `index`（问题在 `findings` 中的位置）：`PATH_NOT_IN_DIFF`（文件不在审查开始时的改动清单中）· `LINE_OUT_OF_RANGE`（行号不在所指版本的文件里，带 `lineCount`）（27 §4.4）。

## 6. 待实施契约：统一附件与需求清单

以下是 30 / 31（精简版）的设计登记。**附件的枚举、常量与错误码已在 U-01 加入 shared**（`enums/attachment.ts`、`constants/limits.ts`、`errors/codes.ts`）；其余未加入源码，不能当作当前接口可用。

| 枚举／类型 | 值 |
| --- | --- |
| AttachmentSource | upload · project_file |
| AttachmentOwnerKind | task_input（owner 为任务）· task_feedback（owner 为追加的修改节点）· assistant_message（owner 为助手对话） |
| AssistantToolName 增量（U-02 已实现） | read_attachment |
| InputRef 增量（U-03 已实现） | attachment（确认卡把附件 ID 显示为文件名） |
| McpToolName 增量（U-02 已实现） | read_attachment |
| NodeKind 增量（Q-02 已实现） | verify（核验验收清单的系统步骤） |
| RequirementVerification（Q-01 已实现，下同） | command · ai_review · manual |
| RequirementResultSource | command · ai · user |
| RequirementConclusion | pass · fail · unverified · waive（命令与 AI 只给前三种，用户给 pass · fail · waive） |
| RequirementDisplayStatus（派生，不持久化） | passed · failed · unverified · stale · waived |

| 常量 | 值 |
| --- | --- |
| ATTACHMENTS_PER_INPUT_MAX | 10 |
| ATTACHMENT_BYTES_MAX | 5 MiB |
| ATTACHMENT_NAME_MAX_CHARS | 255（显示名） |
| ATTACHMENT_PROMPT_MAX_CHARS / ATTACHMENT_READ_MAX_CHARS | 20,000（一次提示词里全部附件合计）/ 12,000（每次读取）（U-02 已实现） |
| ATTACHMENT_ORPHAN_TTL_MS / ATTACHMENT_CLEANUP_INTERVAL_MS | 86,400,000（无引用附件的保留时间）/ 3,600,000（清理间隔） |
| REQUIREMENTS_MAX（Q-01 已实现，下同） | 30 |
| REQUIREMENT_TITLE_MAX_CHARS / REQUIREMENT_EXPECTED_MAX_CHARS / REQUIREMENT_NOTE_MAX_CHARS | 120 / 2,000 / 4,000 |

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| ATTACHMENT_NOT_FOUND | 404 | 不存在或不在当前范围（其他任务／对话），不泄露内容 |
| ATTACHMENT_INVALID_TYPE | 400 | 不是严格 UTF-8 或含 NUL 字节（首版只支持文本） |
| ATTACHMENT_TOO_LARGE | 413 | 大小或单次输入个数超限，`details.limit` 为超过的那个上限值 |
| ATTACHMENT_SOURCE_INVALID | 400 | 项目文件越界（含 `.git` 内）、指向根外的符号链接、不存在或非普通文件（`details.reason`：`outside` · `missing`）、行号超出末尾（`details.lineCount`），或任务在该项目没有可用的工作区 |
| REQUIREMENTS_NOT_EDITABLE（Q-01 已实现） | 409 | 任务状态不允许编辑清单（只有 `draft`、`plan_review`、`review` 可以），或不在 `review` 时请求重新核验／人工结论 |
| REQUIREMENT_RESULTS_INVALID（Q-02 已实现） | —（只经执行 MCP 返回） | 非核验节点提交 `requirement_results`，或项不属于当前版本、不是 AI 核验项、重复 |
| REQUIREMENTS_UNACKNOWLEDGED（Q-03 已实现） | 409 | 交付时有未满足的必需项，而没有带 `acknowledgedRequirementsRevisionId` 或它不是当前清单版本；`details.items` 列出这些项 |；`details.revisionId` 为当前版本。判断「未满足」的 `isUnmet`（failed / unverified / stale）在 shared，前后端共用
