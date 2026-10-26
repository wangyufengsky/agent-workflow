# 40 · 项目的 AGENTS.md

> 状态：**用户要求**（2026-10-26：「在项目管理里新增 AGENTS.md 管理，可以查看项目的 AGENTS.md，或者用 AI 生成 / 补充 AGENTS.md；生成 / 补充时可以额外添加一些适合 agent-workflow 使用的规则」），决策 D202–D205 按本文推荐方案实现（05 的 AM-01、AM-02），待用户检查。

## 1. 为什么要有

opencode 在每个会话开始时读取工作目录（任务的 worktree）根目录的 `AGENTS.md`，把它当作项目规则。规则写得好，规划、执行、评审都少走弯路，「首次通过率」（19）随之提高；没有它，每个任务都要重新摸索检查命令、目录结构和代码约定，用户在「再改改」与审查意见里一遍遍纠正同样的问题。

现在应用里看不到项目有没有 `AGENTS.md`、写了什么，也没有办法让 AI 帮忙写。

## 2. 范围

| 做 | 不做 |
| --- | --- |
| 项目详情页「AGENTS.md」面板：显示默认分支上根目录的 `AGENTS.md`（Markdown 渲染） | 在应用里手动编辑 `AGENTS.md`（用户用自己的编辑器改，提交后这里就能看到） |
| 「让 AI 生成」（没有时）/「让 AI 补充」（已有时）：开一个任务，AI 在独立 worktree 里写，结果照常检查、待合并、由用户合并 | 子目录的 `AGENTS.md`、`CLAUDE.md`、`.cursorrules` 的管理（AI 写的时候会读它们作参考） |
| 可选（默认勾选）加入「在 Agent Workflow 中工作」一节规则，面板里可以预览这一节 | 从「再改改」与审查意见中自动提炼约定（之后另行设计） |
| 助手可以查看、可以开这个任务（写操作，确认卡片） | 新的内置流程按钮：它不出现在主页「直接开始」、流程列表、批量与定时任务里 |

## 3. 决策

| 编号 | 决定 | 理由 |
| --- | --- | --- |
| D202 | 生成 / 补充作为**系统流程** `system.agents_md`「整理 AGENTS.md」的任务运行（13 §4a 的同一机制）：独立分支与 worktree、两步（梳理项目约定 → 编写 AGENTS.md）、AI 评审、待合并、用户点合并 | 01 §2 第 4、6 条：AI 不碰用户主工作区、合并永远由人点。复用任务的全部能力（进度、会话流、再改改、结果卡、diff、PR），不另做一套「AI 写文件」。系统流程不出现在主页与流程列表里，不违反 38 C6「主页流程按钮不超过 5 个」 |
| D203 | 面板显示的是**项目默认分支上已提交**的根目录 `AGENTS.md`（`git cat-file`），不是主工作区里的文件 | 任务从默认分支建 worktree，AI 读到的正是这一份；主工作区里未提交的改动 AI 看不到，显示它反而误导。面板写明「默认分支 main 上的版本」 |
| D204 | 「适合 Agent Workflow 的规则」是 AGENTS.md 里独立的一节 `## 在 Agent Workflow 中工作`，开头写明只在 Agent Workflow 的任务里适用；规则原文只定义在 `packages/builtin/prompts/agents-md-rules.md`（`{{checkCommand}}` 填项目的检查命令），面板预览与任务需求都由它渲染 | 「不要自己 commit」这类规则对直接在仓库里工作的人和其他工具（Claude Code、Codex）是错的，限定范围后才能放进共享的 AGENTS.md。规则写进任务需求，用户在任务页能看到 AI 被要求加入了什么 |
| D205 | 补充时保留已有内容与结构：只增加缺的部分、在原有小节里补充；不删除已有内容；发现与代码不符的地方写进结果摘要，不擅自改。已有「在 Agent Workflow 中工作」一节时按规则原文更新这一节 | 已有的 AGENTS.md 是团队写的，AI 的判断可能错；改动经 diff 由用户把关，但大段删改难以审阅 |

## 4. 流程 `system.agents_md`

`packages/builtin/src/system-workflows.ts`，固定流程，`deliverable = code_changes`，检查点全部 `false`。

| 步骤 | 角色 | 指令要点 | 检查 |
| --- | --- | --- | --- |
| `survey`「梳理项目约定」 | developer | 读根目录的 `AGENTS.md`（有时）、`README`、`CONTRIBUTING`、`CLAUDE.md`、`.cursorrules`、构建与包管理文件（`package.json`、`Makefile`、`pom.xml`、`go.mod`、`pyproject.toml` 等）、lint / 格式化 / 类型检查配置、CI 配置、测试目录；在 notes 里整理：项目是什么、主要目录与职责、真实存在的安装 / 构建 / 测试 / lint 命令（逐条注明出处）、从配置与代码看出的约定、测试约定、提交与分支约定；不改文件 | 无 |
| `write`「编写 AGENTS.md」 | developer | 先用 `get_node_output` 读 `survey` 的完整产出。没有 `AGENTS.md` 时在根目录新建；已有时按 D205 补充。内容简洁（建议 200 行以内）、只写对 AI 编码有用的事实与约定，命令必须是仓库里真实存在的；语言跟随已有 `AGENTS.md`，没有时跟随需求。需求里给了「在 Agent Workflow 中工作」一节时照原文加入（已有同名一节时替换它），只按文档语言调整措辞、不改变规则的意思。只改 `AGENTS.md` | AI 评审（关注：命令与路径是否与仓库一致；补充时是否保留了原有内容；是否只改了 AGENTS.md；需求给出的规则是否原意加入） |

只改文档，不跑项目检查命令（与详细设计、需求拆解相同）。

任务标题：「生成 AGENTS.md」/「补充 AGENTS.md」。需求（中文，任务页可见）：

```
为项目生成 AGENTS.md。            ← 或「补充项目的 AGENTS.md，保留已有内容。」
项目的检查命令：`pnpm verify`。    ← 没有时「项目没有设置检查命令」

补充说明：
<用户在面板里写的话>              ← 没写时省略这一段

在 AGENTS.md 中加入下面这一节（已有同名一节时替换它）：  ← 不勾选规则时省略这一段

<agents-md-rules.md 渲染结果>
```

## 5. 规则原文（`agents-md-rules.md`）

一节 Markdown，`{{checkCommand}}` 为项目的检查命令；项目没有检查命令时这一条改为「运行项目的测试」（模板里两条二选一，由后端决定渲染哪一条）。内容要点：

- 只在 Agent Workflow 的任务里适用（工作目录是它为任务建的 worktree）。
- 不执行改写 Git 的命令（commit、checkout、switch、reset、restore、stash、rebase、merge、push、branch、worktree）：步骤通过验收后由应用提交，合并由人决定。
- 只读写当前 worktree 里的文件，不改它以外的路径。
- 提交结果前运行检查命令；不通过就修代码，不改测试断言、不跳过测试、不关闭 lint 规则或调低检查级别。
- 只做这一步要求的事，沿用现有风格与结构，不顺手重构；新增依赖在结果里写明理由。
- 找根因再修，不用默认值、吞掉错误或重试掩盖问题。
- 需求不清楚时按任务的设置提问或做合理假设，并在结果的「假设」里写明。
- 结果摘要用需求的语言，写清改了什么、怎么验证的。

这些规则与执行者的协议提示词（`protocol-execute.md`）一致，写进 AGENTS.md 后对知识问答、助手、评审与用户自己用的 opencode 会话同样生效。

## 6. 接口（11）

| 操作 | 方法与路径 | 风险 | 说明 |
| --- | --- | --- | --- |
| `projects.agentsMd` | `GET /projects/:id/agents-md` | read | `{ branch, file: GitFileDTO \| null, rules, task: TaskSummaryDTO \| null }`：默认分支名；根目录 `AGENTS.md`（没有为 `null`，过大或二进制同 Git 工作台的 `GitFileDTO`）；按本项目渲染的规则原文；本项目最近一个还没结束的整理任务（没有为 `null`） |
| `projects.startAgentsMdTask` | `POST /projects/:id/agents-md/task` | write | 入参 `{ id, guidance?, includeRules }`（`guidance` 为补充说明，≤ 2000 字）；开出 `system.agents_md` 的任务，返回 `TaskDetailDTO`；默认分支不存在时 `GIT_BASE_BRANCH_NOT_FOUND`。生成还是补充由后端按默认分支上有没有 `AGENTS.md` 决定 |

两个操作都在 tasks 模块实现（同 `projects.delete`）：要读任务列表、开任务。助手可以调用（`expose.assistant`），不进命令面板。

## 7. 界面（14 §3.7）

项目详情页在「项目」面板之后加「AGENTS.md」面板（两种模式都有）：

- 头部一行：「默认分支 `main` 上的版本」或「默认分支 `main` 上还没有 AGENTS.md。」，一句说明「AI 在每个任务开始时读它，写清检查命令、目录结构和代码约定能让任务少走弯路。」
- 有文件时：Markdown 渲染，最高 360px、内部滚动；过大或二进制时一句说明。
- 有进行中的整理任务时：「整理任务 T-12 · 执行中」链接到任务页，下面的表单不显示。
- 否则表单：「补充说明（可选）」多行输入；勾选「加入适合 Agent Workflow 的规则」（默认勾选）与「预览这一节」（展开渲染后的规则）；主按钮「让 AI 生成」/「让 AI 补充」。成功后跳到任务页。

## 8. 测试（07）

| 层 | 内容 |
| --- | --- |
| 集成 | `projects.agentsMd`：没有文件为 `null`、有文件返回默认分支上的内容（主工作区未提交的改动不出现）、规则里是项目的检查命令；`projects.startAgentsMdTask`：开出系统流程的任务，标题与需求按有无文件区分、含补充说明、不勾规则时没有规则段；任务进行中时 `task` 指向它；FakeOpencode 写好 `AGENTS.md` 后任务到待合并 |
| E2E | J44：项目详情没有 AGENTS.md → 预览规则 → 写补充说明 →「让 AI 生成」→ 任务页 → FakeOpencode 两步完成到待合并 → 合并 → 回到项目详情面板显示新内容 |
| live | 不加：提示词只是固定步骤的指令，与详细设计同类；用户试用后按需要补 |
