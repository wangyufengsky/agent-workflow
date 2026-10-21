# 22 · 定时任务（v1.2）

按计划自动运行一个**固定流程**，例如每晚为某个模块补单元测试、每周一检查依赖。每次运行开一个普通任务，结果进入「需要你处理」等你确认；合并仍需你点击（D16）。

决策：D90（计划怎么写、时区）、D91（应用没开时错过的运行、上一次没结束）、D92（定时任务的边界：流程、结果、风险）。三项均按保守方案实现，**待用户确认**。任务拆分见 [05 · v1.2 定时任务](05-dev-plan.md#v12--定时任务)。

## 1. 定位与边界

- **每次运行就是一个普通任务**：自己的分支、worktree、计划（流程模板）、节点、尝试、「需要你处理」条目与交付，全部复用现有任务链路（09 §2）与调度（03 §8）。定时任务只负责「到点开一个任务」，不另起执行引擎。
- **只支持固定流程**（`planning = fixed`），与批量任务一致（D85）：AI 规划流程每次都要规划、可能要确认计划，无人值守地跑没有意义。用 AI 规划流程创建或改成 AI 规划流程返回 400 `VALIDATION_FAILED`（`path: ['workflowKey']`）。
- **按流程 key 引用，运行时取最新版本**：内置流程随应用升级、自定义流程被编辑后，之后的运行用新版本（已开始的任务照常保留自己的版本，13 §5）。流程被删除后，下一次运行开不了任务，按 §5 处理。
- 运行开出的任务**不确认计划**（`confirm_plan = false`，固定流程的计划就是模板，同 D85）；`accept_each_node` 与 `ask_on_uncertainty` 按流程定义与设置解析（11 §5.1）。
- **只在应用打开时运行**：这是桌面应用，后端随应用启动与退出，没有系统级的后台服务。应用没开、电脑睡眠时错过的运行按 §4 处理。
- 一个定时任务属于一个项目，创建后不能换项目（换项目就新建一个）；流程、需求、基础分支、频率都可以修改。

## 2. 计划怎么写（D90）

只提供三种**预设频率**，两种模式相同，不开放 cron 表达式（专业模式也不开放）：

| 频率 `kind` | 字段 | 界面说法 | 例 |
| --- | --- | --- | --- |
| `daily` | `time` | 每天 HH:MM | 每天 02:00 |
| `weekly` | `weekdays`、`time` | 每周几 HH:MM（可多选） | 每周一、三、五 09:00；工作日 = 周一至周五 |
| `hourly` | `everyHours`、`time` | 每 N 小时，从 HH:MM 起 | 每 6 小时，从 00:30 起 = 每天 00:30、06:30、12:30、18:30 |

- `time` 为 `HH:MM`（24 小时制）。`weekdays` 为 0–6（0 = 周日，与 JavaScript `getDay()` 相同），不重复、至少一天；界面从周一排起。
- `everyHours` 只能取 24 的约数 `SCHEDULE_EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12]`：每天的运行时刻固定（`time` 加 N 小时的倍数，按天循环），不会随天数漂移，界面能直接列出当天的全部时刻。
- 不开放 cron 的理由：用户说的需求（每晚、每周一、每几个小时）三种预设都能表达；cron 需要引入解析依赖或自写解析器，五段语法对简单模式用户是内部术语，写错了也很难看出来。以后真有预设表达不了的需求再加。
- **时区**：按本机系统时区（与质量与用量相同，`AppDeps.timeZone`）的墙上时间计算。「每天 02:00」就是本机时钟的 02:00；夏令时切换当天，不存在的时刻（如 02:30 被跳过）顺延到切换之后的同一偏移处，重复的时刻只运行一次。修改系统时区后，已算好的下一次运行时刻不变，从它之后按新时区计算。
- 下一次运行时刻 `next_run_at` 在创建、修改频率、恢复、每次到点处理后计算（`nextRunAfter(frequency, after, timeZone)`，纯函数，单测覆盖）；暂停期间不计算，界面显示「已暂停」。

## 3. 状态机（09 §11）

定时任务有「启用 / 暂停」两种状态，经状态机改变（06 §1.5）：

| 状态 | 含义 |
| --- | --- |
| `active` | 启用：到点运行 |
| `paused` | 已暂停：不运行；用户暂停，或某次运行开不了任务（§5） |

| 事件 | 转换 | 触发 |
| --- | --- | --- |
| `pause` | `active → paused` | 用户点「暂停」 |
| `resume` | `paused → active` | 用户点「恢复」；从现在起计算下一次运行，暂停期间错过的不补 |
| `start_failed` | `active → paused` | 到点时开不了任务（§5） |

没有终态：删除定时任务即删除记录（运行记录随之删除，已开出的任务保留）。

## 4. 到点运行（D91）

后端启动、API 开始监听后（与任务调度同时，`app.start`）启动定时器：

- 定时器只看 `active` 的定时任务，按最早的 `next_run_at` 设一个注入时钟的定时器，但**最长等 `SCHEDULE_CHECK_INTERVAL_MS`（60 秒）就再看一次**：Node 的定时器在电脑睡眠时不走，系统时间也可能被调整，短间隔检查保证醒来后最多晚一分钟发现到期。创建、修改、恢复、删除后立即重排。
- 每次检查，对每个 `next_run_at ≤ 现在` 的定时任务处理**一次**：
  1. **折叠错过的时刻**：从 `next_run_at` 起数到现在为止的全部到期时刻，只运行最后一个（`due_at`），之前的记为 `missed`（不补跑）。
  2. **判断是否补跑**：`现在 − due_at > SCHEDULE_CATCH_UP_AFTER_MS`（5 分钟）或 `missed > 0` 记为补跑（`trigger = catch_up`），否则为准时（`on_time`）。应用没开、电脑睡眠后醒来，都走这一条。
  3. **上一次还没结束就跳过**：上一次开出的任务还不是终态（执行中、等你处理、等你合并、失败待处理……）时，本次不开任务，记一条 `skipped` 运行。理由：同一件事同时开两个任务大概率互相冲突，也会在「需要你处理」里堆出重复的待合并；等你处理完上一个，下一次到点就会照常运行。
  4. 否则开任务：检查项目、最新流程版本与基础分支（与创建任务相同的 `checkCreate`），在一个事务里写入任务草稿与 `started` 运行记录，提交后 `start`。
  5. `next_run_at` 设为「现在」之后的下一个到期时刻。
- 所以**应用关闭期间错过的运行，下次打开时最多补跑一次**，界面在运行记录里写明「补跑：原定 10月21日 02:00（应用未打开），另有 2 次错过」。
- 多个定时任务同时到点，各开各的任务，并发交给调度器的上限（`scheduler.maxConcurrentAttempts`）。opencode 还没就绪时任务照常创建，等运行时就绪后被调度。

## 5. 开不了任务时

到点时 `checkCreate` 等抛出 `AppError`（基础分支被删、流程被删除、项目仓库不可用……）：

- 记一条 `failed` 运行（带错误信息）；
- 定时任务经 `start_failed` **自动暂停**，避免每次到点都失败、反复打扰；
- 创建一条「需要你处理」条目（`schedule_failure`，不属于任何任务）：「定时任务没能开始：<原因>」，按钮「查看定时任务」与「忽略」。用户修好原因后在定时任务页点「恢复」；恢复或删除定时任务时，这条条目自动关闭（恢复为 `resolved`，删除为 `dismissed`）。

不是 `AppError` 的异常是程序缺陷：按 error 级别记录（`schedule tick failed`），本次检查中断，下一次检查照常进行（不让一个缺陷停掉全部定时任务，同 D70 的思路）。

## 6. 结果怎么交给你（D92）

- 运行开出的任务与手动开的完全一样：做完到「待合并」时出现在「需要你处理」的「待合并」条目，失败时出现「任务失败」条目，AI 提问与权限请求也照常出现。**合并永远需要你点击（D16）**，定时任务没有自动合并的选项。
- 「需要你处理」与主页的条目注明来源：「定时任务「每晚补单测」· T-12 …」（前端由定时任务列表的 `activeTask` 得出：每个定时任务同时至多一个未结束的任务，§4 第 3 步）。
- 定时任务页列出最近 `SCHEDULE_RUNS_SHOWN`（20）次运行：时间、准时 / 补跑 / 手动、结果（开了任务 → 任务编号、标题与状态徽标；跳过 → 「上一次还没结束」；失败 → 原因）。

## 7. 页面

入口：主页固定流程卡片的「定时」（与「批量」并列）、流程页（专业模式）固定流程卡片的「定时运行」、任务列表页右上角「定时任务」、命令面板「新建定时任务」、应用助手。

**定时任务列表** `/schedules`：卡片显示标题（需求首行）、项目与流程、频率（「每天 02:00」）、下一次运行（「明天 02:00」）或「已暂停」、最近一次运行的结果；「新建定时任务」。

**新建 / 修改** `/schedules/new?projectId&workflow=<key>`、`/schedules/:scheduleId/edit`：

```
┌──────────────────────────────────────────────────────────┐
│  新建定时任务                                              │
│  项目 [订单服务 ▾]    流程 [补单元测试 ▾]（只列固定流程）     │
│  ┌ 要做什么 ──────────────────────────────────────────┐   │
│  │ 为 src/order/ 补充单元测试，覆盖主要行为与边界情况。   │   │
│  └───────────────────────────────────────────────────┘   │
│  多久一次  (•) 每天  ( ) 每周  ( ) 每隔几小时                │
│            时间 [02:00]                                   │
│  到点时应用要开着；错过的会在下次打开时补跑一次。              │
│  每次运行开一个任务，结果在「需要你处理」等你确认，合并要你点。 │
│                                     [创建定时任务]         │
└──────────────────────────────────────────────────────────┘
```

- 「每周」显示周一到周日的勾选（`aria-pressed` 的切换按钮）；「每隔几小时」显示 N 的下拉与「从 HH:MM 起」，下方列出当天的运行时刻。
- 基础分支只在专业模式显示（默认项目默认分支，留空 = 每次运行时的默认分支）。
- 修改页不能换项目。

**定时任务页** `/schedules/:scheduleId`：频率与下一次运行、状态徽标（启用 / 已暂停，自动暂停时注明原因）；操作「立即运行一次」「暂停 / 恢复」「修改」「删除」（确认对话框）；正在进行的任务（链接）；运行记录表。

- 「立即运行一次」：不改变计划时刻，记一条 `manual` 运行；上一次还没结束时按钮不可用，接口返回 409 `SCHEDULE_BUSY`；开不了任务时直接报错，不自动暂停（你就在现场）。

简单模式文案用用户的话：「多久一次」「下次运行」「补跑」「上一次还没结束，这次跳过了」，不出现 cron、触发器、`due` 之类的词。

## 8. 数据模型（迁移 `0012_schedules`）

`schedules`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects，CASCADE | 删除项目时随之删除 |
| workflow_key | TEXT | 流程 key（不建外键：运行时取最新版本，流程被删除时按 §5 处理） |
| title | TEXT | 需求首行（`TASK_TITLE_MAX_CHARS`） |
| requirement | TEXT | 每次运行的任务需求 |
| base_branch | TEXT NULL | 空 = 运行时的项目默认分支 |
| frequency | TEXT(JSON) | `ScheduleFrequency`，读出后 zod 解析 |
| status | TEXT | `ScheduleStatus`，只经状态机改变 |
| next_run_at | INTEGER NULL | 暂停时为空 |
| created_at / updated_at | INTEGER | |

`schedule_runs`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| schedule_id | TEXT → schedules，CASCADE | |
| trigger | TEXT | `ScheduleRunTrigger`：`on_time` / `catch_up` / `manual` |
| outcome | TEXT | `ScheduleRunOutcome`：`started` / `skipped` / `failed` |
| due_at | INTEGER | 本次运行对应的计划时刻（手动运行为点击时刻） |
| missed | INTEGER | 折叠掉的更早的计划时刻数（§4） |
| task_id | TEXT NULL → tasks，SET NULL | `started` 时开出的任务 |
| error | TEXT(JSON) NULL | `failed` 时的 `ErrorInfo` |
| created_at | INTEGER | 实际处理时刻 |

索引：`schedule_runs(schedule_id)`（按插入顺序读最新的运行）。运行记录不清理（每小时一次也只是一年八千多行）。

## 9. API 与操作清单

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/schedules?projectId` | `schedules.list` | read | `{ items: ScheduleDTO[] }`，按创建时间倒序，不分页（定时任务数量有限） |
| POST | `/schedules` | `schedules.create` | write | `{ projectId, workflowKey, requirement, frequency, baseBranch? }` → 201 `ScheduleDetailDTO`；只用固定流程；检查基础分支存在；`produces: schedule` |
| GET | `/schedules/:id` | `schedules.get` | read | `ScheduleDetailDTO`；404 `SCHEDULE_NOT_FOUND` |
| PATCH | `/schedules/:id` | `schedules.update` | write | `{ workflowKey?, requirement?, frequency?, baseBranch? }`（`baseBranch: null` 恢复默认）→ `ScheduleDetailDTO`；改频率时重算下一次运行 |
| POST | `/schedules/:id/pause` | `schedules.pause` | write | `active → paused` |
| POST | `/schedules/:id/resume` | `schedules.resume` | write | `paused → active`，关闭该定时任务的 `schedule_failure` 条目 |
| POST | `/schedules/:id/run` | `schedules.run` | write | 立即运行一次 → `ScheduleDetailDTO`；409 `SCHEDULE_BUSY` |
| DELETE | `/schedules/:id` | `schedules.delete` | critical | 204；已开出的任务保留 |

全部 `mode = simple`、`expose.assistant = true`；`schedules.create` 进命令面板（打开新建页）。创建为 write 而不是 critical：定时任务只会开任务，任务的产出要你合并才进入主分支（D16）；删除与其他删除操作一样为 critical。

```ts
type ScheduleFrequency =
  | { kind: 'daily'; time: string }                          // 'HH:MM'
  | { kind: 'weekly'; weekdays: number[]; time: string }     // 0 = 周日
  | { kind: 'hourly'; everyHours: 1 | 2 | 3 | 4 | 6 | 8 | 12; time: string };

type ScheduleRunDTO = {
  id: string; trigger: ScheduleRunTrigger; outcome: ScheduleRunOutcome;
  dueAt: number; missed: number; createdAt: number;
  task: TaskSummaryDTO | null; error: ErrorInfo | null;
};
type ScheduleDTO = {
  id: string; title: string; requirement: string;
  project: { id: string; name: string };
  workflow: { key: string; name: string | null };   // name 为空：流程已删除
  baseBranch: string | null;
  frequency: ScheduleFrequency;
  status: ScheduleStatus;
  nextRunAt: number | null;                          // 暂停时为空
  activeTask: TaskSummaryDTO | null;                 // 上一次开出、还没结束的任务
  lastRun: ScheduleRunDTO | null;
  createdAt: number; updatedAt: number;
};
type ScheduleDetailDTO = ScheduleDTO & { runs: ScheduleRunDTO[] };   // 最近 SCHEDULE_RUNS_SHOWN 次，新的在前
```

SSE：新增 `schedule.updated { scheduleId }`（创建、修改、暂停 / 恢复、每次运行、删除后），前端刷新定时任务查询；查询挂在任务列表的缓存前缀下，开出的任务的状态变化也一并刷新。

## 10. 助手

- 八个操作全部注册进操作清单；`schedules.create` 声明 `produces: { kind: schedule, ref: (s) => ({ id, title }) }`，确认后对话中出现定时任务的导航卡片，「打开」进入定时任务页。
- 用户可以说「每天晚上两点给订单模块补单测」，助手调用 `schedules_create`（write，需确认，可「总是允许」）；`schedules_delete` 为 critical，每次确认。
- 不新增助手页面类型（`AssistantPage`），同批量任务。

## 11. 实现结构与测试

- `packages/shared`：`schedule/schedule.ts`（`scheduleTimesOfDay`、`formatTime` 等纯函数）、`enums/schedule.ts`（`ScheduleStatus`、`ScheduleFrequencyKind`、`ScheduleRunTrigger`、`ScheduleRunOutcome`）、`fsm/schedule.machine.ts`、`contracts/api/schedules.ts`、`operations/schedules.ts`、`EntityKind.Schedule`、`InboxKind.ScheduleFailure`、`ServerEventType.ScheduleUpdated`、`SCHEDULE_*` 常量、错误码 `SCHEDULE_NOT_FOUND` / `SCHEDULE_BUSY`。
- `packages/server/src/core/time-zone.ts`：时区换算（`offsetAt`、`zonedInstant`），质量与用量的 `startOfDay` 与定时任务共用。
- `packages/server/src/modules/schedules/`：`schedules.table.ts`、`schedules.repo.ts`、`schedules.next.ts`（`nextRunAfter`）、`schedules.service.ts`（依赖 `tasks`、`workflows`、`projects`、`inbox`）、`schedules.timer.ts`（检查循环）、`schedules.operations.ts`。`schedules` 在 `tasks` 之上、`assistant` 之下；`tasks` 不知道定时任务（运行表引用任务表）。
- 前端：`features/schedules/`（列表、新建 / 修改页、定时任务页、频率选择器）、主页流程卡片的「定时」、流程页的「定时运行」、任务列表入口、「需要你处理」卡片的来源与 `schedule_failure` 卡片；四套主题走查加入新的页面。
- 测试（07）：
  - 单元：`nextRunAfter`（三种频率、跨天跨周、夏令时跳过与重复的时刻）；频率 schema（时刻格式、空的星期、非约数小时）；状态机表。
  - 集成（FakeClock + FakeOpencode + 真实 Git，不真实等待）：到点开任务（需求、固定流程最新版本、不确认计划）、任务到「待合并」后「需要你处理」有待合并条目；上一次没结束时跳过并记录；应用关闭期间错过多次，重启后只补跑一次（`catch_up`、`missed`）；基础分支被删后到点失败 → 自动暂停 + `schedule_failure` 条目，恢复后条目关闭；AI 规划流程 400；立即运行与 `SCHEDULE_BUSY`；删除项目级联删除。
  - E2E（FakeOpencode）J19：主页「补单元测试」的「定时」→ 每天 02:00 → 创建 → 定时任务页显示下一次运行 → 「立即运行一次」→ 任务到达待合并，「需要你处理」的条目注明来自该定时任务 → 合并 → 暂停后显示「已暂停」。
