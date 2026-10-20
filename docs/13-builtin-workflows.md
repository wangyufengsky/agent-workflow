# 13 · 内置流程与角色

内置流程的质量直接决定简单模式好不好用，按产品功能对待：提示词改动走代码评审，并有对应的 live 测试（见 07 §6）。

数据位于 `packages/builtin/`：

```
packages/builtin/
├─ src/roles.ts                角色定义（提示词为 prompts/roles/<key>.md）
├─ src/workflows.ts            流程定义（AI 规划流程的指引为 prompts/workflows/<key>.md）
├─ src/builtins.ts             读入提示词后的种子数据（loadBuiltinRoles / loadBuiltinWorkflows）
└─ prompts/
   ├─ protocol-plan.md         aw-planner agent 基础提示词：工作方式、工具使用规则
   ├─ protocol-execute.md      aw-executor
   ├─ protocol-review.md       aw-reviewer（评审检查用 submit_review；本身就是审查步骤的节点用 submit_result）
   ├─ start-plan.md            首条消息模板（Mustache 风格 {{var}}，无逻辑；空段落填 None.）
   ├─ start-execute.md
   ├─ start-review.md
   ├─ start-answer.md          把用户答案发回会话
   ├─ replan.md                「按意见重新规划」时发回规划会话的反馈消息
   ├─ rule-ask.md / rule-assume.md  ask_on_uncertainty 开 / 关时首条消息中的提问规则
   ├─ nudge.md                 提醒提交结果
   ├─ revise.md                「让 AI 再改改」节点指令模板
   ├─ revise-conflict.md       「交给 AI 解决冲突」节点指令模板
   ├─ roles/*.md
   └─ workflows/*.md           各 AI 规划流程的规划指引
```

每次启动时，后端把内置定义同步进数据库（`kind=builtin`）：流程内容变化（名称、说明、规划方式、产出、定义任一项）则新增一个版本并设为最新，旧版本保留给引用它的任务；角色没有版本，内容变化时就地更新。用户不能修改内置定义（`WORKFLOW_READONLY` / `ROLE_READONLY`），只能复制（M5）。

提示词写给模型，用英文；节点标题、角色名、流程名是给用户看的数据，用中文。要求模型「摘要、说明、问题用需求的语言书写」，因为它们会显示给用户。

## 1. 项目检查命令

项目可设置 `checkCommand`（如 `pnpm test`、`mvn -q test`），添加项目时根据仓库文件推断并预填（`package.json` → 包管理器 + `test` 脚本；`pom.xml` → `mvn -q test`；`build.gradle*` → `./gradlew test`；`go.mod` → `go test ./...`；`pyproject.toml` → `pytest`），用户可改可清空。

流程中验收命令写作 `$PROJECT_CHECK`，计划确认物化节点时替换；项目未设置时该检查被移除（不报错），只保留其他检查。


## 2. 内置角色

| key | 名称 | base_agent | 提示词要点 |
| --- | --- | --- | --- |
| `planner` | 规划师 | planner | 先读代码再规划；节点粒度为「一个人一次能完成并验证的改动」；写清每个节点的输入、产出、验收；不确定处按 askOnUncertainty 规则处理 |
| `developer` | 开发工程师 | executor | 遵循仓库现有风格；最小必要改动；**不写兜底和过度防御代码，缺陷找根因**；改完自己跑相关测试；不做 Git 提交 |
| `tester` | 测试工程师 | executor | 测试验证行为而非实现细节；不写冗余测试；不为通过测试而修改被测代码的行为（发现缺陷写进 notes） |
| `reviewer` | 评审员 | reviewer | 对照需求与本节点指令评审；只报真实问题并给出位置；区分 blocker / major / minor；不提风格偏好类意见 |

## 3. 内置流程

### 3.1 `feature` · 新功能开发

| 项 | 值 |
| --- | --- |
| planning | `ai`，plannerRole `planner` |
| deliverable | `code_changes` |
| allowedRoles | `developer` `tester` |
| 规划指引 | 2–8 个节点；先数据/接口后实现后测试；能并行的节点不要串行依赖 |
| requiredSteps | `final_verify`（position: last）·「整体验证」· tester · 「运行完整检查，修复本任务引入的失败，确认需求每一条都已实现」· acceptance `{ checks: [command $PROJECT_CHECK, ai_review(focus: 需求完整性与正确性)], manual: false }` |
| defaultAcceptance | `{ checks: [command $PROJECT_CHECK], manual: false }` |
| checkpoints | confirm_plan `false`，accept_each_node `false` |

### 3.2 `bugfix` · 修 Bug

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `code_changes` |
| template | `locate`「定位根因」developer：复现问题，写一个能稳定复现的失败测试，在 notes 中写明根因与证据；不修复 → `fix`「修复」developer：修复根因（不是掩盖症状），让复现测试通过，不破坏其他测试 |
| acceptance | `locate`：无检查；`fix`：`[command $PROJECT_CHECK, ai_review(focus: 是否修复根因而非绕过症状，是否引入兜底逻辑)]` |
| checkpoints | 全部 `false` |

### 3.3 `unit_tests` · 补单元测试

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `code_changes` |
| template | `analyze`「分析测试缺口」tester：按需求范围找出缺少测试的关键行为，在 summary 中列出清单（不写代码）→ `write_tests`「编写测试」tester：按清单编写测试 |
| acceptance | `write_tests`：`[command $PROJECT_CHECK, ai_review(focus: 测试是否断言了真实行为、是否有冗余或脆弱测试)]` |
| checkpoints | 全部 `false` |

### 3.4 `code_review` · 代码审查（只读）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `report` |
| template | `review`「代码审查」reviewer：按需求描述的范围（分支、提交区间、目录）审查，产出问题清单（severity / 位置 / 说明 / 建议） |
| acceptance | 无 |
| 交付 | 结果卡显示审查报告，按钮只有「完成」（`report_only`）与「据此修复」（以报告为需求新建一个 `bugfix` 或 `feature` 任务，预填需求） |

### 3.5 `refactor` · 重构

| 项 | 值 |
| --- | --- |
| planning | `ai`，plannerRole `planner` |
| deliverable | `code_changes` |
| allowedRoles | `developer` `tester` |
| 规划指引 | 行为保持不变；每个节点后测试都应通过；拆成可独立验证的小步 |
| requiredSteps | `baseline`（position: first）·「建立基线」· tester ·「运行现有测试并记录结果；若重构范围缺少覆盖，先补特征测试」→ `final_verify`（position: last）·「整体验证」· tester · acceptance `[command $PROJECT_CHECK, ai_review(focus: 外部行为是否保持不变)]` |
| defaultAcceptance | `{ checks: [command $PROJECT_CHECK], manual: false }` |

> requiredSteps 的 `position`：`first` 要求其他所有节点（传递地）依赖它；`last` 要求它（传递地）依赖所有其他节点。违反时 `PLAN_INVALID` 子码 `REQUIRED_STEP_ORDER`。

## 4. 系统生成的节点

| 来源 | key | 标题 | 角色 | 指令模板 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| 让 AI 再改改 | `revise_<n>` | 按反馈修改 | developer | `revise.md`：用户反馈 + 当前结果摘要 | 当前所有叶子节点 |
| 交给 AI 解决冲突 | `resolve_conflict_<n>` | 解决合并冲突 | developer | `revise-conflict.md`：冲突文件列表；后端在创建节点前已于 worktree 执行 `git merge --no-ff --no-commit <target>`（`target` 为冲突的那次交付的目标分支）并保留冲突标记；节点完成时后端的提交即结束这次合并（合并提交） | 当前所有叶子节点 |

定义在 `packages/builtin/src/system-nodes.ts`（`SYSTEM_NODES`）。两者 acceptance 均为 `{ checks: [command $PROJECT_CHECK], manual: false }`（任务开启 `accept_each_node` 时另加人工验收），`kind = revise`，`n` 从 1 起按任务内同类节点计数。计划新版本 `source = user`、`feedback` 为用户反馈（模型经 `get_task_context.userFeedback` 读到），创建后立即确认，只物化新增的节点；任务的交付条目随之 dismiss，再次进入 `review` 时重新创建。

## 5. 自定义流程（专业模式）

- 从内置流程复制，或新建空白（选 fixed / ai）。
- 编辑器：fixed 流程编辑模板 DAG（同计划画布组件）；ai 流程编辑规划指引、允许角色、必经步骤。
- 检查点默认值、默认验收。
- 保存前 `POST /workflows/validate`；保存产生新版本，运行中的任务继续用旧版本。
