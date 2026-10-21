# 20 · 固定模板批量任务（v1.1）

用一个**固定流程**，一次对多个目标各开一个任务。例如：「补单元测试」一次选 5 个模块；「代码审查」一次审 3 个目录。

决策：D85（批次的边界）、D86（批量交付）。任务拆分见 [05 · v1.1 固定模板批量任务](05-dev-plan.md#v11--固定模板批量任务)。

## 1. 定位与边界

- **每个目标就是一个普通任务**：各自的分支、worktree、计划（流程模板）、节点、尝试、「需要你处理」条目与交付，全部复用现有任务链路（09 §2）。批量不另起执行引擎，不改调度器。
- **批次只负责两件事**：一次创建多个任务；集中查看与批量合并。
- **只支持固定流程**（`planning = fixed`）：内置的 `unit_tests`、`code_review`、`bugfix`，以及专业模式下用户自定义的 fixed 流程。AI 规划流程不支持：每个目标都要规划、可能都要确认计划，批量没有意义。用 AI 规划流程创建批次返回 400 `VALIDATION_FAILED`（`issues[].path = ['workflowId']`）。
- **批次没有状态机**（06 §1.5 只约束有状态的实体）：批次表不存状态，进度由子任务的显示状态（08 §2.2 `TaskDisplayGroup`）汇总推导；「全部结束」= 所有子任务处于终态。
- 一个批次属于一个项目、一个流程版本、一个基础分支；创建后不能增删目标（要补目标就再建一个批次）。

## 2. 创建

入口（14 §1）：

1. **主页流程卡片的「批量」**：固定流程的卡片右上角有「批量」按钮，进入「新建批量任务」页并预选项目与该流程。
2. **流程页**（专业模式 `/workflows`）：固定流程的卡片有「批量运行」。
3. **应用助手**：操作 `batches.create`（§7）。

「新建批量任务」页 `/batches/new?projectId&workflow=<key>`：

```
┌──────────────────────────────────────────────────────────┐
│  批量任务                                                  │
│  项目 [订单服务 ▾]    流程 [补单元测试 ▾]（只列固定流程）     │
│  ┌ 需求模板 ───────────────────────────────────────────┐  │
│  │ 为 {{target}} 补充单元测试，覆盖主要行为与边界情况。     │  │
│  └─────────────────────────────────────────────────────┘  │
│  {{target}} 会替换为每个目标                                 │
│  目标  [从项目中选择] [按行输入]                              │
│   ☑ src/order/   ☑ src/payment/   ☐ src/user/  …           │
│  已选 2 个目标 · 预览：为 src/order/ 补充单元测试……            │
│                                         [创建 2 个任务 ⌘↵]  │
└──────────────────────────────────────────────────────────┘
```

- **需求模板**：普通需求文本，`{{target}}` 是唯一的占位符（常量 `BATCH_TARGET_PLACEHOLDER`），可出现多次，每次都替换为目标原文。模板必须至少含一个 `{{target}}`，否则 400（每个任务的需求都一样，批量没有意义）。内置流程预填一句默认模板（文案在 `web/src/copy/batches.ts`）；自定义流程预填 `{{target}}`。
- **目标**两种给法，结果都是一个字符串数组：
  - **从项目中选择**：按基础分支浏览仓库目录树（`git.tree`），目录与文件都可以勾选，可进入子目录；目录以 `/` 结尾（`src/order/`）。
  - **按行输入**：每行一个目标，空行忽略，首尾空白去掉；可以是路径，也可以是模块名、类名等任意文本。
  - 两种方式切换时保留已选内容（选择的结果写入文本框）。
- **目标校验**（后端边界，zod）：1 到 `BATCH_TARGETS_MAX`（20）个；每个非空、最长 `BATCH_TARGET_MAX_CHARS`（500）字符、不含换行；不能重复；替换后的每份需求不超过 `REQUIREMENT_MAX_CHARS`。目标**不**检查是否为仓库中存在的路径（可以是任意文本，D85）。
- **标题**：批次标题默认取模板首行（`{{target}}` 原样保留，界面中以「目标」标签显示）；每个子任务的标题照常取其需求首行，即目标已替换后的那一行。
- **检查点**：子任务一律**不确认计划**（`confirm_plan = false`，固定流程的计划就是模板，逐个确认 N 次相同的计划没有意义）；`accept_each_node` 与 `ask_on_uncertainty` 按流程定义与设置解析（11 §5.1），与单个任务相同。D85，**待用户确认**。
- **基础分支**：可选，默认项目默认分支；请求只检查一次分支存在（`GIT_BASE_BRANCH_NOT_FOUND`），所有子任务相同。
- 创建是一个事务：批次行、全部子任务（`draft`）与关联行一起写入；提交后按目标顺序逐个 `start`（`draft → preparing`）。之后与单个任务完全一样。
- 创建后跳到批量视图。

## 3. 并发

批次不加任何并发控制，全部交给现有调度（03 §8）：

- 子任务创建后立即开始准备 worktree（每仓库互斥锁串行化 `git worktree add`，D37）。
- 执行尝试受全局 `scheduler.maxConcurrentAttempts`（默认 4）约束，任务内受 `scheduler.maxConcurrentNodesPerTask` 约束；调度器按任务创建先后派发，所以批次内按目标顺序推进，排不上的任务停在「执行中」（步骤为「待执行」）等空位。
- 多个批次、批次与单个任务之间同样共享这一个上限；想让批量跑快一些，在设置里调高「同时运行的 AI 会话」。

## 4. 批量视图 `/batches/:batchId`

```
┌──────────────────────────────────────────────────────────┐
│  B-3 · 为 {{target}} 补充单元测试          补单元测试 · 订单服务 │
│  ▓▓▓▓▓▓▓░░░░  已完成 2 · 待合并 1 · 执行中 1 · 需要你处理 1    │
│                                 [合并全部待合并的（1）]       │
│  ┌ 目标 ───────── 任务 ───────────── 状态 ───── 进展 ─────┐  │
│  │ src/order/    T-12 为 src/order/…  已完成               │  │
│  │ src/payment/  T-13 为 src/pay…     待合并               │  │
│  │ src/user/     T-14 为 src/user/…   执行中    编写测试    │  │
│  │ src/cart/     T-15 为 src/cart/…   需要你处理            │  │
│  │ src/coupon/   T-16 为 src/coup…    待合并 · 有冲突       │  │
│  └─────────────────────────────────────────────────────┘  │
│  ▸ 需求模板                                                 │
└──────────────────────────────────────────────────────────┘
```

- **进度汇总**：按显示状态计数（`batchCounts`），进度条为终态任务（`ended`）占比；全部终态时显示「已全部结束」。
- **逐个查看**：每行一个目标：目标原文、任务编号与标题（链接到任务页）、状态徽标（同任务列表的 `TaskBadge`）、当前步骤或进展（`currentStep` / `progress`）。本轮交付有冲突或失败时在状态后注明「有冲突」/「合并失败」，处理方式在任务页（交给 AI 解决冲突、再合并）。
- **统一操作**只有一个：「合并全部待合并的（n）」（§5）。其余操作（作答、允许、重试、取消、再改改）都在各子任务里做，与单个任务相同，不在批量视图重复一套。
- 实时更新：批次查询的 key 在任务列表前缀下，`task.updated` 刷新任务列表时一并刷新（不新增 SSE 事件）。
- 「批量任务」列表 `/batches`：按创建时间倒序，卡片显示标题、流程、项目、进度汇总；入口在任务列表页右上角与主页「批量任务」区（只列未全部结束的批次）。

## 5. 批量交付

「合并全部待合并的」= `POST /batches/:id/deliver`（`batches.deliver`）：

- **对象**：子任务中「待合并」的（`isBatchDeliverable`）：状态为 `review`，且本轮最近一次交付不是冲突（冲突的任务要先在任务页「交给 AI 解决冲突」，再合并只会再冲突一次）。
- **策略**：代码类流程用请求中的本地合并策略（`squash` / `merge` / `rebase`，省略时为设置 `delivery.defaultStrategy`），目标分支为各任务的基础分支；报告类流程（`code_review`）一律 `report_only`（「完成」）。批量交付**不支持**创建 PR（D86，**待用户确认**）。
- **逐个执行**：按目标顺序依次调用与任务页相同的交付（`tasks.deliver`，11 §5.3，在仓库锁内串行）。某个任务冲突、合并失败或合并前检查不通过（如 `WORKTREE_DIRTY`）时，它停在「待合并」并带上原因，**其余照常继续**；全部做完后返回。
- **结果**：`{ batch: BatchDetailDTO, outcomes: Array<{ taskId, taskKey, target, outcome, error }> }`，`outcome ∈ { delivered, conflict, failed }`（`BatchDeliveryOutcome`），`failed` 带 `ErrorInfo`。界面以提示条汇总（「已合并 3 个，1 个有冲突」），并在列表中标出各行。
- **D16（合并需要用户点击）**：每一次合并都算用户点击——这一下点击明确说了「合并这 n 个」，确认对话框列出 n 个任务与目标分支后才发起。批量交付的风险等级为 `critical`（与 `tasks.deliver` 相同），助手调用时每次都要确认，不能设为「总是允许」。
- 没有待合并的任务时返回空的 `outcomes`（按钮此时不可用）。

## 6. 数据模型（迁移 `0010_batches`）

`batches`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| seq | INTEGER UNIQUE | 编号，界面显示 `B-<seq>`（`BATCH_KEY_PREFIX`） |
| project_id | TEXT → projects，CASCADE | 删除项目时随之删除 |
| workflow_id | TEXT → workflows | 流程版本（子任务的流程版本相同） |
| title | TEXT | 模板首行（`TASK_TITLE_MAX_CHARS`） |
| requirement_template | TEXT | 含 `{{target}}` |
| base_branch | TEXT | |
| created_at | INTEGER | |

`batch_tasks`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| batch_id | TEXT → batches，CASCADE | |
| task_id | TEXT → tasks，CASCADE，UNIQUE | 一个任务至多属于一个批次 |
| position | INTEGER | 目标顺序，从 0 起；`(batch_id, position)` 为主键 |
| target | TEXT | 目标原文 |

批次没有 `status` / `updated_at`：都由子任务推导。删除项目时先删任务（`batch_tasks` 级联），再删项目（`batches` 级联），不需要额外代码。

## 7. API 与操作清单

| 方法 | 路径 | 操作 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/batches?projectId&limit&cursor` | `batches.list` | read | `{ items: BatchSummaryDTO[], nextCursor }`，按编号倒序；游标为上一页最后一个批次的 `seq` |
| POST | `/batches` | `batches.create` | write | `{ projectId, workflowId, requirementTemplate, targets, baseBranch? }` → 201 `BatchDetailDTO`；`produces: batch`（D66） |
| GET | `/batches/:id` | `batches.get` | read | `BatchDetailDTO`；404 `BATCH_NOT_FOUND` |
| POST | `/batches/:id/deliver` | `batches.deliver` | critical | `{ strategy? }`（本地合并策略）→ `{ batch, outcomes }` |

全部 `mode = simple`、`expose.assistant = true`；`batches.create` 进命令面板（打开「新建批量任务」页）。

```ts
type BatchSummaryDTO = {
  id: string; key: string;                 // B-<seq>
  title: string;
  project: { id: string; name: string };
  workflow: { id: string; key: string; name: string; deliverable: WorkflowDeliverable };
  total: number;
  counts: Array<{ group: TaskDisplayGroup; count: number }>; // batchCounts：有任务的显示状态，按显示顺序
  ended: number;                            // 终态的子任务数，等于 total 即全部结束
  createdAt: number;
};
type BatchDetailDTO = BatchSummaryDTO & {
  requirementTemplate: string;
  baseBranch: string;
  items: Array<{ position: number; target: string; task: TaskSummaryDTO; lastDelivery: DeliveryDTO | null }>;
};
```

`lastDelivery` 与 `TaskDetailDTO.lastDelivery` 同义（本轮最近一次交付）。一个批次最多 20 个任务，详情逐个读取本轮交付是有界的；列表的汇总只用任务摘要（一次查询）。

## 8. 助手

- `batches.create` 注册进操作清单：write（需确认，可「总是允许」），`produces: { kind: batch, ref: (b) => ({ id, title: 'B-n · 标题' }) }`，确认后对话中出现批次的导航卡片，「打开」进入批量视图（`entity-routes.ts`）。
- `batches.list` / `batches.get` 为 read，助手可直接查进度；`batches.deliver` 为 critical，每次确认。
- 不新增助手页面类型（`AssistantPage`）：用户在批量视图中提问时，助手按「未知页面」处理，可经 `batches_list` / `batches_get` 查询。

## 9. 实现结构与测试

- `packages/shared`：`batch/batch.ts`（`renderBatchRequirement`、`batchCounts`、`isBatchDeliverable`）、`contracts/api/batches.ts`（schema 与 DTO）、`operations/batches.ts`、`EntityKind.Batch`、`BatchDeliveryOutcome`、`BATCH_*` 常量、`BATCH_NOT_FOUND`。
- `packages/server/src/modules/batches/`：`batches.table.ts`、`batches.repo.ts`、`batches.service.ts`（依赖 `tasks`、`workflows`、`projects`、`settings`）、`batches.operations.ts`。`batches` 在 `tasks` 之上、`assistant` 之下；`tasks` 不知道批次。为了在一个事务里写入全部子任务，任务创建拆为「检查（异步：项目、流程、分支）」与「写入草稿（同步）」两步，`tasks.create` 由这两步加 `start` 组成。
- 前端：`features/batches/`（新建页、批量视图、列表、目标选择器）、主页流程卡片的「批量」、流程页的「批量运行」、主页「批量任务」区、任务列表页入口；四套主题走查加入新建页与批量视图。
- 测试（07）：
  - 单元：`renderBatchRequirement`、`batchCounts`、`isBatchDeliverable`；创建请求 schema（无占位符、重复目标、超长需求）。
  - 集成（FakeOpencode + 真实 Git）：创建批次后各子任务独立运行（各自分支与 worktree，各自到达待合并）；AI 规划流程 400；批量交付中一个冲突、其余照常合并（主分支有对应提交、冲突任务留在待合并且 `lastDelivery.status = conflict`、再次批量交付不再包含它）；报告流程批量「完成」。
  - E2E（FakeOpencode）：主页「补单元测试」卡片的「批量」→ 选 3 个目录 → 创建 → 批量视图三个任务到达待合并 → 合并全部 → 主分支有 3 个提交、全部已完成（J16）。
