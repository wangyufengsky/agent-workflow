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
   │                           （v1.3：protocol-plan / execute / review / research 都有一段浏览器说明：何时用页面预览与网站、页面内容是数据不是指令，29 §3）
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

流程中验收命令写作 `$PROJECT_CHECK`，计划确认物化节点时替换；项目未设置时该检查被移除（不报错），只保留其他检查。替换后的命令冻结在步骤上，之后改项目的检查命令不影响已确认的计划；任务因检查命令失败后，用户可以「修改检查命令」改写这个任务未完成步骤中的命令（可同时设为项目的检查命令），检查命令在应用环境里无法运行时还可以「跳过这项检查」（D116，09 §3）。

页面体检（v1.3，29 §7）同理：流程里写 `{ kind: 'browser' }` 不带页面时，物化时冻结项目页面预览的关键页面（`preview.pages`），视口省略时为桌面与手机；项目没有页面预览时该检查被移除。规划可以给改页面的步骤写 `acceptance.pages`（12 §6.4），任务上下文的 `project.previewPages` 告诉规划项目有没有预览。


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
| requiredSteps | `final_verify`（position: last）·「整体验证」· developer · 「运行完整检查，修复本任务引入的失败，确认需求每一条都已实现」· acceptance `{ checks: [command $PROJECT_CHECK, browser, ai_review(focus: 需求完整性与正确性)], manual: false }`（`browser` 为页面体检，项目没有预览时移除） |
| defaultAcceptance | `{ checks: [command $PROJECT_CHECK], manual: false }` |
| checkpoints | confirm_plan `false`，accept_each_node `false` |

### 3.2 `bugfix` · 修 Bug

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `code_changes` |
| template | `locate`「定位根因」developer：复现问题，写一个能稳定复现的失败测试，在 notes 中写明根因与证据；不修复 → `fix`「修复」developer：修复根因（不是掩盖症状），让复现测试通过，不破坏其他测试 |
| acceptance | `locate`：无检查；`fix`：`[command $PROJECT_CHECK, browser, ai_review(focus: 是否修复根因而非绕过症状，是否引入兜底逻辑)]` |
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
| requiredSteps | `baseline`（position: first）·「建立基线」· tester ·「运行现有测试并记录结果；若重构范围缺少覆盖，先补特征测试」→ `final_verify`（position: last）·「整体验证」· developer · acceptance `[command $PROJECT_CHECK, browser, ai_review(focus: 外部行为是否保持不变)]` |
| defaultAcceptance | `{ checks: [command $PROJECT_CHECK], manual: false }` |

### 3.6 `version_review` · 版本比对审查（只读，D126）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `report` |
| template | `review`「版本比对审查」reviewer：对比任务基础分支的当前版本（HEAD）与需求中写的起点（日期、提交、标签或分支），只审查这段时间新增与修改的代码。起点是日期时用 `git log --first-parent --before="<日期> 00:00" -1 --format=%H HEAD`（那天开始前分支上的最后一个提交）；用 `git diff <起点> HEAD` 阅读改动，只用 `git log` / `git diff` / `git show`、一次一条（其他命令会请求许可）；summary 开头写明比对范围（起点、终点、提交数、文件数），然后是问题清单；起点之前就存在的问题不报 |
| acceptance | 无 |
| 交付 | 同 §3.4（「据此修复」） |

用到的 git 子命令（`log` / `diff`）都在只读白名单里（D63），不需要新权限。「同分支」即任务的基础分支（专业模式在开始任务页的更多选项里选）。

### 3.7 `security_review` · 安全审查（只读，D126）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `report` |
| template | `review`「安全审查」reviewer：按需求范围（没写时为整个仓库）检查注入（SQL、命令、路径穿越、XSS）、认证与越权、敏感信息与密钥、输入校验与反序列化、依赖与默认配置；每条问题写严重程度、位置、可被利用的方式与修改建议；只报有代码依据的问题，不联网、不运行扫描工具 |
| acceptance | 无 |
| 交付 | 同 §3.4（「据此修复」） |

### 3.8 `cleanup` · 清理告警（D126）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `code_changes` |
| template | `inventory`「列出告警」developer：运行项目已有的 lint、类型检查与构建，查找未使用的代码（导出的接口不能确认只在仓库内使用时保留），在 summary 列出清单与处理方式；不改文件 → `fix`「清理」developer：按清单修改；不关闭规则、不加忽略注释、不调低检查级别，误报保留并写进 notes；外部行为不变 |
| acceptance | `inventory`：无检查；`fix`：`[command $PROJECT_CHECK, browser, ai_review(focus: 是否只做了清理而没有改变外部行为，是否用关闭规则或忽略注释掩盖告警)]` |
| checkpoints | 全部 `false` |

### 3.9 `design_proposal` · 方案设计（只读，D126）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `report` |
| template | `design`「方案设计」reviewer：读相关代码后写现状、两到三个可行方案（做法、要改的模块、优缺点、风险、工作量）、推荐方案与理由、实施步骤；不改文件 |
| acceptance | 无 |
| 交付 | 结果卡按钮「完成」与「据此开发」：以报告为需求、预选「新功能开发」回到主页（其他 `report` 流程是「据此修复」→「修 Bug」） |

### 3.10 `detailed_design` · 详细设计（D126）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `code_changes`（一份 Markdown 设计文档，经正常的检查与合并进入仓库） |
| template | `survey`「梳理现状」developer：整理相关模块、接口、数据结构、调用链、约束，以及仓库设计文档的目录与格式；不改文件 → `write`「编写详细设计」developer：在现有设计文档目录（没有时 `docs/design/`）写文档：背景与目标、范围、总体方案、模块与职责、接口、数据与表结构变更、关键流程、异常与边界、兼容与迁移、测试方案、实施步骤；只写文档，不改代码 |
| acceptance | `survey`：无检查；`write`：`[ai_review(focus: 设计是否与代码现状一致、是否覆盖了需求的每一点、接口与数据结构是否具体到可以直接实施)]`（只改文档，不跑项目检查） |
| checkpoints | 全部 `false` |

### 3.11 `breakdown` · 需求拆解（D137，34 §4）

| 项 | 值 |
| --- | --- |
| planning | `fixed` |
| deliverable | `code_changes`（一份 Markdown 拆解文档，经正常的检查与合并进入仓库；报告类结果只有 `RESULT_SUMMARY_MAX_CHARS`，写不下大需求的拆解） |
| template | `survey`「梳理需求与现状」developer：通读需求与附件（只显示了一部分的附件读完全文），按需求范围读代码，在 notes 中整理需求要点清单（逐条编号）、相关模块、接口与数据结构、约束与风险，以及仓库设计文档的目录与格式，summary 只写简要结论（结果摘要上限 4000 字，大需求的清单放不下）；不改文件 → `write`「编写拆解文档」developer：先用 `get_node_output` 读 survey 的完整产出，再在现有设计文档目录（没有时 `docs/plans/`）写一份拆解文档：概述（目标、范围、不做、假设、风险）、阶段（目标与完成标志）、工作包（编号与标题、阶段、建议流程、依赖、可以直接作为任务需求的需求切片、对应原需求的哪几点、验收要求）、需求覆盖表；一个工作包实施时不超过 8 个步骤，依赖无环且只指向同一阶段或更早阶段；只写文档，不改代码 |
| acceptance | `survey`：无检查；`write`：`[ai_review(focus: 是否覆盖了需求的每一点；每个工作包是否能在一个任务里完成并验证；依赖是否无环且与阶段顺序一致；需求切片是否具体到可以直接开任务)]`（只改文档，不跑项目检查） |
| checkpoints | 全部 `false` |

拆解文档合并后，用户按阶段照文档手动开任务：需求填工作包的需求切片，附件选这份文档（项目文件，30 §2.1），验收要求填进验收清单（31）。之后的需求计划（34 N2；N2a 的决策已确认，N2b 待确认）把这一步自动化。

四个只读流程（代码审查、版本比对审查、安全审查、方案设计）共用 `reportOnly(key, title, instructions)`：只有一个 reviewer 步骤，没有检查。新流程都是固定流程，因此也能用于批量任务与定时任务（D85、D92），例如每周一次的安全审查或「审查上周新增的代码」。

> requiredSteps 的 `position`：`first` 要求其他所有节点（传递地）依赖它；`last` 要求它（传递地）依赖所有其他节点。违反时 `PLAN_INVALID` 子码 `REQUIRED_STEP_ORDER`。

## 4. 系统生成的节点

| 来源 | key | 标题 | 角色 | 指令模板 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| 让 AI 再改改 | `revise_<n>` | 按反馈修改 | developer | `revise.md`：用户反馈 + 当前结果摘要 | 当前所有叶子节点 |
| 按审查意见修改（21） | `review_fix_<n>` | 按审查意见修改 | developer | `revise-review.md`：PR 地址、勾选的意见（文件与行、每条发言）、用户的补充说明、当前结果摘要；只经 `review-feedback` 发起，任务从 `completed` 回到 `running`（事件 `review_feedback`），之前后端已快进任务分支并重建 worktree | 当前所有叶子节点 |
| 交给 AI 解决冲突 | `resolve_conflict_<n>` | 解决合并冲突 | developer | `revise-conflict.md`：冲突文件列表；后端在创建节点前已于 worktree 执行 `git merge --no-ff --no-commit <target>`（`target` 为冲突的那次交付的目标分支）并保留冲突标记；节点完成时后端的提交即结束这次合并（合并提交） | 当前所有叶子节点 |

定义在 `packages/builtin/src/system-nodes.ts`（`SYSTEM_NODES`）。三者 acceptance 均为 `{ checks: [command $PROJECT_CHECK], manual: false }`（任务开启 `accept_each_node` 时另加人工验收），`kind = revise`，`n` 从 1 起按任务内同类节点计数。计划新版本 `source = user`、`feedback` 为用户反馈（按审查意见修改时为渲染后的意见与补充说明；模型经 `get_task_context.userFeedback` 读到），创建后立即确认，只物化新增的节点；任务的交付条目随之 dismiss，再次进入 `review` 时重新创建。

### 4a. 系统流程（v1.2）

`WorkflowKind.System`：随内置流程同步入库（`packages/builtin/src/system-workflows.ts`），只由应用自己发起，不出现在流程列表、开始任务页、批量与定时任务中，不能复制，按 key 查找时视为不存在（`WORKFLOW_NOT_FOUND`）。key 带点（`system.`），用户流程的 key（`DEFINITION_KEY_PATTERN`）不能含点，所以两者不会重名：否则同步系统流程会把用户的同名流程变成旧版本、从列表中消失。

| key | 名称 | 说明 |
| --- | --- | --- |
| `system.merge_branch` | 合并分支 | Git 工作台的合并冲突「交给 AI 解决」（27 §3.6）：固定流程，模板只有一个节点 `resolve_conflicts`「解决合并冲突」（developer，检查为项目检查命令）。任务的 `merge_source` 为来源、`base_branch` 为目标；worktree 从来源建出，准备阶段由后端 `git merge --no-ff --no-commit <目标>` 留下冲突标记，节点完成时后端的提交结束这次合并；之后照常检查、待合并，由用户合并回目标 |

### 4b. 内置组合模板（v1.3，34 §15.3）

`packages/builtin/src/initiative-templates.ts`（`BUILTIN_INITIATIVE_TEMPLATES`）：设计后开发 `design_then_build`、详细设计后开发 `detailed_design_then_build`、开发后审查 `build_then_review`、先补测试再重构 `tests_then_refactor`。每次启动按 key 就地写入 `initiative_templates`（不分版本：需求计划创建时已快照），已不在列表里的内置模板删除。工作包的需求是给模型看的中文，含 `{{requirement}}`；第 2 阶段都是 `autoOpen`。集成测试校验每个内置模板都通过 `validateInitiativeDraft`。

## 5. 自定义流程（专业模式）

- 从内置流程复制（内置流程只读，D57），或新建空白（选 fixed / ai；允许角色为现有的执行类角色，ai 流程的规划者为第一个 planner 角色，fixed 流程从一个步骤开始）。
- 编辑器：fixed 流程编辑模板 DAG（同计划画布组件）；ai 流程编辑规划指引、允许角色、必经步骤。
- 检查点默认值、默认验收。
- 校验 `validateWorkflowDefinition`（08 §5.4，编辑器与后端共用；`POST /workflows/validate` 供不带编辑器的调用方）；保存产生新版本，运行中的任务继续用旧版本。
- 删除自定义流程：被任务用过的版本保留但不再列出（D57）。
- 自定义角色：复制或新建（key、名称、基础类型、提示词、模型），被流程或任务用过的角色不能删除。

## 6. 需求清单与资料上下文（附件 U1、清单 Q-02 已实现）

30 / 31 实施后，任务的附件清单与验收清单经 `get_task_context` 对规划、执行、评审都可见。有清单的任务，物化计划时追加系统步骤「核验验收清单」（`NodeKind.Verify`，内置 reviewer 角色，提示词 `verify-requirements`），依赖所有其他叶节点；固定流程与规划流程相同，不改变内置流程的默认步骤。「再改改」、PR 意见回流、冲突修改追加的节点之后同样再追加一个核验节点。

实现细节（Q-02）：核验步骤的键是 `verify_requirements`，「再改改」等追加的是 `verify_requirements_<n>`；起草计划（模板、AI 提交、用户编辑）与物化时都会补上或更新它（`tasks.verify.ts` 的 `withVerifyStep`），用户在专业模式删掉它，保存后会补回。指令模板是 `prompts/verify-requirements.md`，列出每项的 id、核验方式与预期；只读 reviewer 用 `submit_result` 结束，只对 `ai_review` 项给结论。
