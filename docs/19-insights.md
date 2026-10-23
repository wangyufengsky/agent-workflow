# 19 · 质量与用量（v1.1）

> 状态：**v1.1 已实现**，待合并（任务 I-01…I-08，见 [05](05-dev-plan.md#v11--质量与用量)）。D79（只统计 tokens，不统计成本）与 D80（自写柱状图）用户已确认（2026-10-21）。

## 1. 定位

回答三个问题：**AI 帮我做了多少事、做得好不好、用了多少。**用量只按 tokens 统计，不统计成本（D79：用户本地用的模型都是免费的）。

- **只读展示**：不改变任何业务状态，不新增采集；所有数字由已有的表现算（§2.1）。
- **如实显示**：没有数据时显示「—」与原因，不显示 0%。
- **默认简单**：简单模式只有一行三个数（本周完成了几个任务、用了多少 tokens、打扰了你几次）；专业模式是完整的拆分、趋势、质量与钻取。
- 应用助手可以调用同一组只读操作回答「这周用了多少」（§4）。

## 2. 指标口径

### 2.1 数据来源

| 表 | 用到的列 |
| --- | --- |
| `attempts` | `kind`、`status`、`task_id`、`node_id`、`role_id`、`model`、`tokens_input`、`tokens_output`、`error.code`（`cost` 照常存储，不统计、不展示，D79）、`started_at` |
| `tasks` | `status`、`project_id`、`workflow_id`、`started_at`、`finished_at`、`updated_at` |
| `nodes` | `task_id`、`status`（首次通过与重试按尝试表计算，不用会被重试清零的 `attempt_count`） |
| `task_events` | 节点的 `checks_failed`、`reject` 事件；任务第一次进入 `review` 的时间 |
| `inbox_items` | `kind` 为 `question` / `permission` 的条目及其 `response` |
| `knowledge_turns` → `knowledge_conversations` | `research` 尝试所属的项目 |
| `projects`、`workflows`、`roles` | 拆分维度的名称 |

**不在本看板统计内**：应用助手对话的用量——助手会话不产生尝试，其实际报告现单独记录在 `assistant_turns`，在对话输入区查看单轮与会话累计（15 §6.2）；开发构建的调试尝试（既不属于任务也不是 `research`）。页面注明助手用量请在对话中查看；更早的助手历史不补造零值。

### 2.2 时间段

| `InsightsPeriod` | 范围（含首尾两天） |
| --- | --- |
| `today` | 今天 |
| `week` | 本周一到今天（周一为一周的第一天） |
| `last_7_days` | 今天及之前 6 天 |
| `last_30_days` | 今天及之前 29 天 |
| `custom` | `from`、`to`（`YYYY-MM-DD`），`from ≤ to`，最多 `INSIGHTS_MAX_DAYS`（366）天；否则 `VALIDATION_FAILED` |

- **时区**：后端进程的系统时区（与界面在同一台机器上），即 `AppDeps.timeZone`，助手报时用的也是它。一天 = 该时区的 0:00 到次日 0:00，按 `Intl` 计算，夏令时那天是 23 或 25 小时；时钟跳过 0:00 的时区（如 `America/Havana`），那天从跳到 1:00 的那一刻开始。
- 时间段换算为毫秒区间 `[from 当天 0:00, to 次日 0:00)`；每条记录按下面各指标规定的时间点归入区间与某一天。

### 2.3 用量

**范围**：`started_at` 在时间段内的尝试中，属于任务的（`plan` / `execute` / `review`）与知识问答的（`research`）。一次尝试的用量全部计在它开始的那一天。

| 指标 | 计算 |
| --- | --- |
| 尝试数 | 范围内尝试的条数（含没有报告用量的） |
| 输入 / 输出 tokens | `tokens_input`、`tokens_output` 之和；为空（会话没有完成过一步）记 0。取 opencode 每一步报告的 `input` / `output`：不含缓存读写与推理 tokens（已有数据只记了这两项） |

**拆分**（`InsightsDimension`，每组都有上面三项，按输入 + 输出 tokens 降序）：

| 维度 | 分组键 | 名称 |
| --- | --- | --- |
| `project` | 任务或知识对话的项目 | 项目名称 |
| `workflow` | 任务流程的 key（同一流程的各版本合并） | 流程最新版本的名称；`research` 尝试为空键，界面显示「知识问答」 |
| `role` | 角色 key | 角色名称；`research` 尝试没有角色，空键显示「知识研究员」 |
| `model` | 尝试的 `model` | 空 = 发送时未指定，界面显示「opencode 默认模型」 |
| `kind` | `AttemptKind` | 界面显示规划 / 执行 / 评审 / 知识问答 |

**趋势**：时间段内每一天一个点：输入 / 输出 tokens、当天完成的任务数（§2.4 结束时间为当天且状态为已完成）。没有记录的天也有点（全 0）。

### 2.4 质量

质量统计一个**任务集合**：时间段内**结束**的任务（D79 ③）。结束时间：已完成、已取消取 `finished_at`；失败取 `updated_at`（失败后只有重试或取消会再改它，二者都会改变状态）。失败的任务之后被重试并完成，按完成的那次计入。

| 指标 | 计算 | 分母为 0 时 |
| --- | --- | --- |
| 结束的任务 | 已完成 / 已取消 / 失败各几个 | — |
| 完成率 | 已完成 ÷ 结束的任务 | 空 |
| 首次通过率 | 这些任务中状态为 `done` 的节点里，只有一次**有效执行尝试**的比例。有效执行尝试 = 该节点 `execute` 类、状态不是 `interrupted` 的尝试（运行时或应用中断不算质量问题，与 09 §3 不消耗预算一致） | 空 |
| 平均重试 | 这些任务中状态为 `done` 或 `failed` 的节点，`max(0, 有效执行尝试 − 1)` 的平均值。用户点「重试」、人工验收驳回后的再次尝试都计入 | 空 |
| 失败原因 | 这些任务的：节点 `checks_failed` 事件（「检查未通过」）、节点 `reject` 事件（「人工验收未通过」）、状态为 `failed` 的执行尝试按 `error.code` 分组（`aborted` 是用户或取消任务停下的，不算）。按次数降序 | 空列表 |
| 人工打扰 | 这些任务的 `question` 与 `permission` 条目数，不含按默认假设直接记录的提问（`response.assumed = true`，它没有打扰用户）；另给平均每个任务几次 | 平均为空 |
| 到待合并的耗时 | 已完成的任务：第一次进入 `review` 的事件时间 − `started_at`；取中位数（墙钟时间，含暂停与等你处理的时间） | 空 |

### 2.5 简单模式的三个数（`attention` 与本周）

| 数 | 计算 |
| --- | --- |
| 完成了几个任务 | 本周（`week`）结束且已完成的任务数 |
| 用了多少 | 本周的输入 + 输出 tokens |
| 打扰了你几次 | **本周创建**的 `question` / `permission` 条目数（不含按假设记录的提问），不限于结束的任务，也包括知识研究员的权限请求 |

## 3. 页面与交互

路由 `/insights`，导航「质量与用量」（图标 `chart`），两种模式都显示。设计参考 `originals/main/pages/insights.html`（REVIEW 第 12 节），按「默认简单」收敛：去掉成本与币种（D79）、「已加载 / 未知记录」类说明（数字由后端一次算全，没有分页加载）、质量徽标与评审逐项（看评审到任务页）。

### 3.1 简单模式

- 标题「质量与用量」+ 一句说明「本周 AI 帮你做了多少、用了多少。」
- 三张卡（§2.5）：「完成了 N 个任务」「用了 N tokens」「打扰了你 N 次」。
- 下方一行提示：「在专业模式下查看按项目、流程、角色、模型的 tokens 拆分、每天的趋势和任务明细」，附「开启专业模式」按钮（同 `ProOnly`）。

### 3.2 专业模式

自上而下：

1. **工具条**：时间段分段控件「今天 / 本周 / 近 7 天 / 近 30 天 / 自定义」，默认本周；选「自定义」时出现两个日期输入（默认近 7 天）。时间段写在地址 `?period=&from=&to=`。
2. **用量卡**：tokens 合计、输入 tokens、输出 tokens、尝试数；卡片下注「应用助手对话的用量未记录」。
3. **趋势**：按天的 tokens 柱状图，输入、输出两段堆叠。纵轴取整刻度；横轴日期过多时隔几天标一次；悬停或键盘聚焦某一天时，图上方一行读出日期与数值，图下附同样数据的隐藏表格供读屏。颜色取主题令牌（`--accent`、`--role-2`），四套主题由令牌保证。
4. **拆分**：标签页「项目 / 流程 / 角色 / 模型 / 用途」，表格列：名称、tokens 合计（数值左侧按最大值比例的小横条）、输入、输出、尝试数。点击一行钻取到用到它的任务（知识问答的组没有任务，不可点击）。
5. **质量卡**：完成率（下方「完成 N · 取消 N · 失败 N」）、首次通过率、平均重试、平均打扰、到待合并耗时（中位数）。分母为 0 时显示「—」与「这段时间没有结束的任务」。每张卡可点击钻取。
6. **失败原因**：列表，每行原因文案（错误码按 `copy/errors.ts`）与次数，点击钻取。
7. **任务明细**：本时间段相关的任务（结束的任务 ∪ 有用量的任务），列：任务（链接到任务页）、项目、状态、tokens（比例横条）、重试、打扰、到待合并耗时。钻取时表格上方出现「正在查看：<指标> · 清除」，表格只显示该指标对应的任务，并滚动到表格；钻取写在地址 `?drill=`（`InsightsDrill`）与 `?key=`。

钻取的对应关系（前端纯函数 `drillFilter(drill, key)`，对 §4 `insights.tasks` 返回的行过滤）：

| `InsightsDrill` | 显示的任务 |
| --- | --- |
| `completed` / `cancelled` / `failed` | 结束的任务中该状态的 |
| `first_pass_missed` | 有 `done` 节点不是首次通过的 |
| `retried` | 重试次数大于 0 的 |
| `interrupted` | 打扰次数大于 0 的 |
| `review_duration` | 有到待合并耗时的 |
| `failure` + `key`（原因键） | 有该失败原因的 |
| `project` / `workflow` / `role` / `model` / `kind` + `key` | 在该组有用量的 |

状态：加载中（骨架）、读取失败（`ErrorState`）、这段时间什么都没有（`EmptyState`「这段时间没有 AI 活动」）。

## 4. API（操作清单）

两个操作都是 `risk = read`、`mode = simple`、`expose = { palette: false, assistant: true }`、无凭据字段（D79 ④）。命令面板通过导航项打开页面，不需要单独的操作。

| 方法 | 路径 | 操作 | 说明 |
| --- | --- | --- | --- |
| GET | `/insights?period&from&to` | `insights.summary` | `InsightsSummaryDTO`：时间段、用量合计与五个拆分、按天趋势、质量、`attention` |
| GET | `/insights/tasks?period&from&to` | `insights.tasks` | `{ items: InsightsTaskDTO[] }`：本时间段相关的任务与每个任务的数字，按结束时间、再按创建时间倒序 |

输入（`insightsQuerySchema`）：`period: InsightsPeriod`；`period = custom` 时必须有 `from`、`to`，其余时间段不能带（`VALIDATION_FAILED`）。

```ts
type UsageTotals = { attempts: number; tokensInput: number; tokensOutput: number };   // 不含成本（D79）

type InsightsSummaryDTO = {
  period: { period: InsightsPeriod; from: string; to: string; timeZone: string };   // 日期为 YYYY-MM-DD
  usage: UsageTotals & { groups: Record<InsightsDimension, (UsageTotals & { key: string | null; name: string | null })[]> };
  days: (UsageTotals & { date: string; tasksCompleted: number })[];
  quality: {
    ended: { completed: number; cancelled: number; failed: number };
    completionRate: number | null;            // 0..1
    doneNodes: number; firstPassNodes: number; firstPassRate: number | null;
    finishedNodes: number; retries: number; avgRetries: number | null;
    interruptions: number; avgInterruptions: number | null;
    reviewDurationMedianMs: number | null;
    failureReasons: { kind: InsightsFailureKind; code: string | null; count: number }[];
  };
  attention: { interruptions: number };       // 时间段内创建的提问与权限请求（§2.5）
};

type InsightsTaskDTO = {
  task: TaskSummaryDTO;                       // 与任务列表相同
  usage: UsageTotals;                         // 本时间段内的
  roles: string[]; models: (string | null)[]; kinds: AttemptKind[];   // 本时间段内用到的
  quality: {                                  // 只有在时间段内结束的任务（属于质量集合）才有
    endedAt: number;
    doneNodes: number; firstPassNodes: number; retries: number; interruptions: number;
    failureReasons: { kind: InsightsFailureKind; code: string | null; count: number }[];
    reviewDurationMs: number | null;
  } | null;
};
```

`InsightsFailureKind`：`checks_failed`、`rejected`、`attempt_error`（`code` 为错误码，其余两种为空）。

**应用助手**：两个操作按操作清单自动成为助手工具 `insights_summary`、`insights_tasks`（read，直接执行）。用户问「这周用了多少」时，助手调用 `insights_summary { period: 'week' }`，回答 tokens。`open_page` 增加页面 `insights`。

## 5. 性能

- 聚合在后端一次完成：按时间区间查出用量尝试与结束的任务，再按任务 id 批量查节点、执行尝试、节点事件、打扰条目（每张表一次查询，不逐任务查询，06 §9），在内存中按 §2 汇总。按天分组需要时区换算，SQLite 不支持 IANA 时区，所以在 JS 中归组。
- **索引**（迁移 `0010_insights`）：
  - `attempts(started_at)`：用量按时间区间扫描尝试，尝试是这些表里最大的一张（每个节点每次重试、每次评审、每次提问各一行）；
  - `inbox_items(created_at)`：`attention` 按创建时间扫描，已有的 `(status, created_at)` 以状态开头，用不上。
- 不需要新索引的查询：结束的任务用已有的 `tasks(status, updated_at)`（`updated_at ≥ finished_at`，先按 `updated_at ≥ from` 缩小再判断结束时间）；按任务 id 的批量查询用已有的 `nodes(task_id, status)`、`attempts(task_id, kind)`、`task_events(task_id, id)`、`inbox_items(task_id)`；知识对话、项目、流程、角色按主键。
- 实测（I-04，本机 Apple Silicon Mac，2026-10-21）：5 000 个任务（分布在一年内）、2 万个节点、6 万次尝试、30 万条任务事件的数据库上，读取加汇总：`last_30_days`（409 个结束的任务、4 908 次尝试）首次 70 ms、之后 35–45 ms；`last_7_days` 约 8 ms。`EXPLAIN QUERY PLAN` 确认用量走 `attempts_started_idx`、结束的任务走 `tasks_status_updated_idx`、打扰走 `inbox_created_idx` 与 `inbox_task_idx`。
- 前端：两次请求（汇总与任务明细）；钻取、拆分标签切换都在客户端完成，不再请求。

## 6. 枚举、常量（08）

- `InsightsPeriod`：`today`、`week`、`last_7_days`、`last_30_days`、`custom`。
- `InsightsDimension`：`project`、`workflow`、`role`、`model`、`kind`。
- `InsightsFailureKind`：`checks_failed`、`rejected`、`attempt_error`。
- `InsightsDrill`：`completed`、`cancelled`、`failed`、`first_pass_missed`、`retried`、`interrupted`、`review_duration`、`failure`，以及五个维度（与 `InsightsDimension` 同值）。
- `INSIGHTS_MAX_DAYS = 366`（自定义时间段最多天数）。
- `AssistantPage` 增加 `insights`。

## 7. 实现结构

- `shared/enums/insights.ts`、`shared/contracts/api/insights.ts`、`shared/operations/insights.ts`。
- `server/modules/insights/`：
  - `insights.period.ts`：时间段 → 日期与毫秒区间、某一时刻所在的日期（纯函数，时区参数化）；
  - `insights.aggregate.ts`：由查出的行计算 §2 的全部数字（纯函数）；
  - `insights.repo.ts`：§5 的查询，只读，读取其他模块经其 `index.ts` 导出的表；
  - `insights.service.ts`、`insights.operations.ts`、`index.ts`。
- `web/src/features/insights/`：页面（简单 / 专业两种视图）、`bar-chart.tsx`（自写的 HTML/CSS 柱状图，D80）、`drill.ts`（钻取过滤）、查询；文案 `web/src/copy/insights.ts`。SSE `task.updated`、`attempt.updated`（含知识问答的尝试）与 `inbox.updated` 让这些查询重新读取。

## 8. 测试

| 层 | 测什么 |
| --- | --- |
| 单元 `insights.period.test.ts` | 五种时间段的日期范围（含跨年、周一）；`custom` 的校验；同一时刻在 `Asia/Shanghai` 与 `America/Los_Angeles` 归入不同的日期；夏令时开始那天的区间为 23 小时；跳过午夜的时区（哈瓦那）一天从跳变那一刻开始 |
| 单元 `insights.aggregate.test.ts` | 空数据（全 0、比率为空、每天都有点）；没有报告用量的尝试只计次数；首次通过与重试不计中断的尝试；失败原因的三类与排序；按假设记录的提问不算打扰；到待合并耗时的中位数；拆分的分组与空键 |
| 单元 `drill.test.ts`（web） | 每个钻取键的过滤 |
| 集成 `insights.int.test.ts` | 经 API：FakeOpencode（`usage` 步骤报告 tokens）跑完一个首次通过的任务、一个检查失败后重试通过且有一次提问的任务、一个取消的任务、一次知识问答；`insights.summary` 与 `insights.tasks` 的数字；`custom` 缺日期 400 |
| 集成（助手） | 助手会话调用 `insights_summary`（read）直接返回本周的 tokens |
| E2E `task-insights.browser.spec.ts`（J16） | 用 FakeOpencode 造两个任务后打开页面：简单模式三张卡的数字；专业模式的用量、完成率、首次通过率；点「失败原因」钻取到任务、点任务进入任务页；四套主题切换无报错（走查 J9 也覆盖该页） |
