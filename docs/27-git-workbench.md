# 27 · Git 工作台（重做）

用户试用安装包后的反馈：「git工作台似乎完全没做完，很多功能都没有，包括ai审查，提交，推送，合并等等。前端样式也和设计稿完全不一样，非常简陋」。

M4-08 的 Git 管理台只做了只读浏览（分支、提交、文件、worktree）和「拉取远端」「清理遗留 worktree」两个写操作。本文把它补成一个**用户自己的 Git 工作台**：在主工作区里暂存、提交、推送、拉取，建 / 切 / 删分支，合并（冲突可交给 AI），让 AI 只读地审查改动、提交或分支并给出结构化问题；界面按设计稿 `originals/git/` 重做为三栏工作台。

决策：**D108**（手动操作的范围、边界与风险）、**D109**（AI 审查的实现方式）、**D110**（界面、模式与 AI 草拟提交信息），用户 2026-10-22 确认按推荐方案实现。原型：[design/27-git-workbench/prototype.html](design/27-git-workbench/prototype.html)（`?view=&theme=` 切换八个画面与四套主题；确认设计时的截图在 PR #34 的描述中）。实现见 [05 · v1.2 Git 工作台重做](05-dev-plan.md#v12--git-工作台重做)。

## 1. 现状与设计稿的差距

### 1.1 功能

| 设计稿（`originals/git`、`delivery/git.html`） | 现在 | 本文 |
| --- | --- | --- |
| 仓库概览：每个项目一张卡（分支、领先落后、未提交改动、最近提交、待处理审查问题） | 只有项目名列表 | 做（§6.1） |
| 页头：项目切换、当前分支、领先 / 落后、上次获取时间、获取远端更新 | 分支 chip、领先落后、干净与否、「拉取远端」 | 做，另加「拉取」「推送」（§6.2） |
| 三栏：左栏视图与筛选、中栏按日期分组的提交列表 + 简化图谱、右栏提交详情 | 页签 + 表格，提交详情替换整个列表 | 做（§6.2） |
| 提交筛选：分支、作者、提交信息或 SHA 搜索 | 分支下拉 + 输入提交号 | 做（分支、作者、搜索） |
| 提交详情：正文、作者 / 提交者、完整 SHA（复制）、父提交、所在分支、统计 | 标题、短 SHA、作者时间、正文 | 做 |
| 合并提交选择对比的父提交 | 固定第一个父提交 | 做 |
| diff：统一 / 并排、忽略空白、展开上下文、全宽阅读、大文件 / 二进制 / 重命名 | `DiffBrowser`：统一 / 并排、文件树、大文件只给大小 | 加忽略空白、全宽阅读；展开上下文不做（§8） |
| AI 审查提交（抽屉：范围、维度、职业、上下文）→ 结论卡 + 按严重度的问题列表 + 在 diff 中定位 | 无 | 做，审查对象扩展到工作区改动与分支（§4） |
| AI 一键修复：在 `ai-fix/*` 分支的隔离副本中修复，结果对照、撤销文件、校验 | 无 | 改为「据此修复」开一个普通任务（§4.6） |
| 提交 → 推送 → 合并三步，用户逐步确认；提交信息由 AI 草拟；「提交并推送」 | 无 | 做，作用于用户自己的主工作区（§3） |
| 合并方式：创建合并请求（推荐）/ 直接合并（目标分支受保护、检出且有改动、有冲突时禁用并说明） | 无（只有任务交付能合并） | 做：本地合并 + 创建 PR（§3.5、§3.6） |
| 合并请求列表（GitLab） | 无 | 不做（§8） |
| 分支表：本地 / 远端、当前、领先落后、最后提交、关联 MR、保护锁 | 分支、任务、上游、最近提交 | 做（关联 MR 与保护锁不做） |
| 「改动」：工作区的未提交改动（设计稿只读显示数量） | 只显示数量 | 做成可暂存、可提交的改动视图（§6.3） |
| 回执未知 / 核对原操作 | — | 不做（D11） |

### 1.2 样式

走查截图（`screenshots/walkthrough/*/pro-git-*.png`）与设计稿对比：

- **布局**：现在是普通页面 + 页签 + 全宽表格，宽屏下右侧大片空白；设计稿是占满内容区的三栏工作台（左 220、中 ~380、右自适应），列之间细分隔线，各栏独立滚动。
- **页头**：现在是大标题 + 两个 chip；设计稿是紧凑的工具条（面包屑「Git / 项目 ▾」、分支 chip、领先 / 落后、未提交改动 chip、上次获取时间、右侧操作按钮）。
- **提交列表**：现在是三列表格（标题、短 SHA、作者时间），没有分组与图谱；设计稿按日期分组，每行两行文字（标题 + 头像首字、作者、相对时间、短 SHA），左侧图谱泳道与合并点，HEAD / 分支标签 chip，审查徽标（「3 个问题」「无问题」）。
- **提交详情**：现在是一个 h3 + 一行灰字；设计稿是键值网格（作者、提交者、SHA + 复制、父提交、所在分支、改动统计带增删条），主按钮「AI 审查此提交」，下方页签。
- **控件**：现在的「比较」是两个裸输入框 + 按钮；分支选择是原生 select。设计稿用分段按钮、带图标的下拉、状态胶囊、操作按钮成组。
- **空态与错误**：设计稿每种异常有说明与出路（空仓库、分离 HEAD、读取失败只影响失败的那一块）；现在只有统一的 `ErrorState`。

## 2. 原则与边界

1. **模型不写 Git**（12 §1、D10 的约束不变）。执行会话的 bash 规则照旧 deny `git *`（只放行只读子命令）；审查会话是只读会话。工作台里的提交、推送、合并等全部由**用户点击、后端执行**。
2. **只动用户自己的东西**：工作台的写操作只作用于项目的**主工作区**（`projects.repoPath`）和**不属于进行中任务的分支**；绝不在任务的 worktree 里执行任何命令。边界见 §5。
3. 所有 git 调用经 `runGit`（`LC_ALL=C`、参数数组、机器格式输出）；**所有写操作**在每仓库互斥锁内执行（D37），与任务的交付、worktree 创建与删除串行。
4. 合并永远需要用户点击（D16）：工作台的合并与创建 PR 是 critical，界面先确认；助手调用每次出现确认卡片。
5. 用户自己的操作用**用户自己的身份**：提交、合并提交的作者与提交者取用户的 git 配置（`user.name` / `user.email`），**运行用户的钩子**，签名等其他配置也照用户的。这与任务提交（D48）、任务交付（D52）用 `agent-workflow` 身份、`--no-verify` 相反：那是 AI 的提交，这是用户的提交。
6. 永不强推、不改写已有历史（不提供 rebase、amend、reset）。

## 3. 手动操作（D108）

### 3.1 一览

| 操作 | 执行 | 前置条件（不满足 → 错误，不做任何改动） | 风险 |
| --- | --- | --- | --- |
| 暂存 / 取消暂存 | `git add -- <paths>`；`git restore --staged -- <paths>`（还没有提交时 `git rm --cached`） | 文件级，不做行块暂存 | write |
| 提交 | `git commit --cleanup=strip -m <信息>` | 有已暂存的改动（`GIT_NOTHING_TO_COMMIT`）；用户身份已配置（`GIT_IDENTITY_MISSING`）；主工作区没有进行中的合并 / 变基（`GIT_OPERATION_IN_PROGRESS`） | write |
| 推送 | `git push --porcelain --set-upstream origin refs/heads/<b>:refs/heads/<b>` | 分支不属于进行中的任务；远端拒绝（非快进）→ `GIT_PUSH_REJECTED` | **critical** |
| 获取远端（已有） | `git fetch --all --prune` | — | write |
| 拉取 | 获取上游所在远端后 `git merge --ff-only @{upstream}` | 当前分支有上游（`GIT_NO_UPSTREAM`）；主工作区干净（`WORKTREE_DIRTY`）；不能快进 → `BRANCH_DIVERGED` | write |
| 新建分支 | `git branch -- <name> <start>`，可选「并切换」 | 名称合法（`git check-ref-format --branch`）且不以 `aw/` 开头（任务分支前缀）；不存在（`GIT_BRANCH_EXISTS`） | write |
| 切换分支 | `git switch <b>`；远端分支 → `git switch --track <remote>/<b>` 建本地跟踪分支 | 主工作区干净（`WORKTREE_DIRTY`）；分支没有在别的 worktree 检出（`GIT_BRANCH_IN_USE`，任务的 → `GIT_BRANCH_OWNED_BY_TASK`） | write |
| 删除分支 | `git branch -d`；确认后可 `-D` | 不是当前分支、不是项目默认分支、没有在任何 worktree 检出（`GIT_BRANCH_IN_USE`）；不属于进行中的任务；未合并 → `GIT_BRANCH_NOT_MERGED`，界面再确认一次后以 `force` 删除 | **critical** |
| 合并 | `merge --no-ff` 或 `merge --squash` + 提交（§3.5） | 目标是本地分支、不属于进行中的任务；目标检出的工作区干净 | **critical** |
| 合并冲突交给 AI | 开一个「合并分支」任务（§3.6） | 刚才的合并冲突 | write（之后的合并仍需点击） |
| 创建 PR / MR | 已有的 `GitHostingProvider.createPullRequest`；该分支已有打开的 PR 时直接返回它 | 项目已绑定远端（`HOSTING_NOT_CONFIGURED`）；分支已推送 | **critical** |
| AI 草拟提交信息 | 只读的短会话（§7.3） | opencode 就绪 | read |
| AI 审查 | 只读会话（§4） | opencode 就绪；同一项目没有进行中的审查（`GIT_REVIEW_RUNNING`） | write |

**不做**（D108）：变基（改写用户分支的历史，冲突要多步处理）、stash（全局共享的隐藏状态；有改动时先提交）、标签（不创建也不推送；`git log` 的装饰里照常显示）、cherry-pick / revert、amend、强推、丢弃改动（不可恢复，界面上一次误点就丢掉用户的工作）、行块暂存、删除远端分支（在平台上处理）、reset。

### 3.2 提交

- 提交信息：标题（必填）+ 正文，作为一个参数交给 `git commit -m`（execa 参数数组，不经 shell）。
- 作者与提交者来自用户的 git 配置；提交面板显示「作者：name &lt;email&gt;」，取自 `git var GIT_AUTHOR_IDENT`（读不到即 `GIT_IDENTITY_MISSING`，提示在终端设置 `user.name` / `user.email`）。
- 运行用户的 `pre-commit` / `commit-msg` 钩子；钩子拒绝时 git 以非 0 退出，返回 `GIT_COMMAND_FAILED`，界面把 stderr（钩子输出）展开显示，暂存区不变，可修改后重试；不提供跳过钩子。
- 「提交并推送」是提交按钮下拉里的选项：前端依次调用两个操作，提交失败就不推送；推送仍弹 critical 确认。

### 3.3 推送

- 推送当前分支或分支表里选中的本地分支到 `origin`，分支名不变；没有上游时 `--set-upstream`。
- 认证：项目绑定了远端且 origin 是 HTTPS 时，与 PR 交付一样经环境变量注入令牌（D53）；否则用用户自己的凭据（SSH 密钥、系统凭据管理器），`GIT_TERMINAL_PROMPT=0`（不会卡在密码提示）。
- `--porcelain` 的状态行（`!` + `[rejected]`）判定远端拒绝 → `GIT_PUSH_REJECTED`，提示「远端有你本地没有的提交：先拉取，再推送」；其他失败 `GIT_COMMAND_FAILED`（stderr 可展开）。
- 确认对话框列出：分支 → `origin/<分支>`（新建 / 更新）、将推送的提交（`<upstream>..<branch>`，最多列 20 条）。

### 3.4 分支

- 分支表的行操作：切换、合并到当前分支…、推送、创建 PR、AI 审查（相对默认分支）、与…比较、删除。
- 远端分支只能「检出为本地分支」「合并到当前分支」「比较」「审查」。
- 默认分支与当前分支不能删除；删除本地分支不影响远端。

### 3.5 合并

- 对话框：来源（任意分支或提交）→ 目标（本地分支，默认当前分支），两种方式：
  - **合并提交**（`merge --no-ff`，默认）：保留来源的每个提交；提交信息默认 `Merge branch '<来源>' into <目标>`，可改。
  - **压缩为一个提交**（`merge --squash` + 提交）：提交信息必填，可「AI 草拟」（§7.3，以 `merge-base..来源` 为内容）。
  - 不提供变基与「仅快进」：快进由「拉取」覆盖。
- 执行沿用交付的合并实现（`delivery.merge.ts`，D52）：目标检出在某个工作区（通常是主工作区）时就在那里合并，要求它干净；没有检出时在临时 worktree 中合并后删除。区别只有身份与钩子：工作台的合并用用户身份、运行钩子（§2 第 5 条），实现上给 `mergeLocally` 加一个「谁的合并」参数，不复制代码。
- 目标检出在任务的 worktree、或目标 / 来源是进行中任务的分支 → `GIT_BRANCH_OWNED_BY_TASK`（任务分支的合并只走任务页的交付）。
- 冲突：与交付一样立即中止（`merge --abort` / `reset --merge`），**目标分支不变**，返回冲突文件。界面显示冲突横幅与两个出路：「交给 AI 解决」（§3.6）、「我自己处理」（对话框给出在终端执行的命令）。

### 3.6 合并冲突交给 AI：一个「合并分支」任务

复用「交给 AI 解决冲突」的系统节点（13 §4 `resolve_conflict_<n>`、`revise-conflict.md`）与任务交付，而不是在用户的主工作区里让 AI 改文件：

1. 新的内置流程 `merge_branch`「合并分支」：`planning = fixed`，模板只有一个解决冲突的节点（developer、`revise-conflict.md`、检查为项目检查命令）；不出现在主页的流程列表里，只能从工作台发起。
2. 任务的基础分支 = **目标**（结果卡默认合并回目标；任务 diff 相对目标，正是将要并入的内容），worktree 的起点 = **来源**（新分支 `aw/T-n-merge-<来源>`）。
3. worktree 就绪后、物化计划前，后端在任务 worktree 中执行 `git merge --no-ff --no-commit <目标>`（与「交给 AI 解决」的 `mergeTarget` 同一函数），保留冲突标记；节点完成时后端的提交结束这次合并。
4. 之后一切照常：检查、待合并、用户在结果卡点「合并」（D16）。任务分支已包含目标，选「变基」即快进（D52），其他本地策略也可以；目标得到来源的改动与冲突的解决；来源分支不变。

代价：一个隐藏的内置流程、任务准备阶段多一个「按流程先合并」的步骤（约 60 行）、工作台的入口；这个任务出现在任务列表与「需要你处理」中（它本来就要用户合并）。备选是工作台冲突只给「我自己处理」，不做 AI 解决。

## 4. AI 审查（D109）

### 4.1 选型

| 方案 | 做法 | 优点 | 代价 |
| --- | --- | --- | --- |
| A 复用 `code_review` 流程 | 以「审查 X」为需求开一个代码审查任务 | 后端零改动 | 每次审查建任务、分支与 worktree，进入任务列表与调度队列（排队等并发）；报告是 Markdown，**没有结构化的文件与行**，不能在 diff 中定位；worktree 从基础分支建出，**看不到工作区里未提交的改动** |
| **B 轻量审查尝试（推荐）** | 不属于任务的 `git_review` 尝试（同知识问答的 `research`），只读会话在主仓库中读 diff，用新的 MCP 工具 `submit_findings` 提交结构化问题 | 几秒内开始，不排队；问题带严重度、类别、文件、行与建议，能在 diff 中定位与勾选；能审查工作区改动、单个提交、分支、任意区间 | 新增：尝试类型与 agent、一个 MCP 工具与校验、一张表、提示词（约 500 行后端 + 审查面板约 400 行前端）；审查不计入并发上限（同 D68），并发审查多时模型用量叠加 |
| C 复用评审检查 `submit_review` | 让「AI 评审」检查（`review` 尝试）脱离节点运行 | 工具已有 | `review` 尝试的语义与节点验收绑定（pass / fail、只有 blocker / major / minor、无建议），改造的面比 B 大 |

推荐 B。用量：一次审查读 diff 与相关文件，通常输入数万 tokens、输出数千 tokens；用户手动发起，不自动审查。

### 4.2 审查对象

| 对象 | 从哪里发起 | 范围（记录为 `from` / `to` 两个 SHA） |
| --- | --- | --- |
| 工作区改动 | 改动视图「AI 审查改动」 | `HEAD` → 工作区（已暂存 + 未暂存 + 未跟踪文件）；`to` 为空 |
| 一个提交 | 提交详情「AI 审查此提交」 | 父提交（合并提交为所选的父）→ 该提交 |
| 一个分支 | 分支表「AI 审查」 | `merge-base(默认分支, 分支)` → 分支 |
| 任意区间 | 比较视图「审查这段差异」 | `merge-base(from, to)` → `to` |

发起时可选填「关注点」（一句话，如「并发安全」），不选维度与职业：审查用内置 `reviewer` 角色的模型（专业模式在角色页可改），问题自己带类别。

### 4.3 审查会话

- `AttemptKind.GitReview`，不属于任务；agent `aw-code-reviewer`：权限与研究员相同（`edit` / `question` / `webfetch` / `websearch` / `task` deny，`external_directory` deny，bash 用 `readonlyBashRules()`，不带检查命令：审查不跑测试），提示词 `protocol-code-review.md`（只报真实问题、给位置与建议、不提风格偏好，沿用 reviewer 角色的要求）。
- 会话目录 = 项目主仓库（同研究员，D69）。首条消息给出精确的范围与读取方式：`git diff <from> <to>` / `git show <sha>` / `git diff HEAD` 与未跟踪文件列表，以及改动文件清单与统计；模型可读相关文件了解上下文。
- 审查开始时后端算出改动文件清单存在审查记录上（`files`），校验与界面都用它；工作区改动在审查期间若继续变化，结果以开始时的清单为准，界面注明「审查开始时的工作区」。
- 超时、提醒（nudge）照尝试的通用规则；停止 = 中止尝试。
- 不计入调度器并发（同 D68）；同一项目同时只有一个进行中的审查（`GIT_REVIEW_RUNNING`），避免误点重复消耗。

### 4.4 MCP 工具 `submit_findings`

```ts
{
  summary: string;                        // 结论，1..2000，Markdown
  findings: Array<{                       // 0..50 个
    severity: 'blocker' | 'major' | 'minor';   // 与 submit_review 相同的三级
    category: 'correctness' | 'security' | 'performance' | 'maintainability' | 'tests';
    path: string;                         // 须在本次审查的改动文件清单中
    line?: number;                        // 新版本中的行号（删除的行给旧版本行号并设 side = 'old'）
    end_line?: number;
    side?: 'new' | 'old';                 // 默认 new
    title: string;                        // 1..120
    description: string;                  // 1..2000，Markdown
    suggestion?: string;                  // 建议的改法，1..2000，Markdown（可含代码块）
  }>;
}
```

校验不通过 → `GIT_REVIEW_FINDINGS_INVALID`，`details.problems[]`（`PATH_NOT_IN_DIFF`、`LINE_OUT_OF_RANGE`），每项带给模型的 hint，模型修正后重提（同 `submit_answer` 的引用校验）。通过 → 写入审查记录，尝试 `succeeded`，发 `git_review.updated`。只允许 `git_review` 尝试调用（其他尝试 `MCP_TOOL_NOT_ALLOWED`）。

### 4.5 结果

- 结论卡：一句话结论、按严重度计数（阻断 / 严重 / 一般）、按类别计数、审查对象（范围、文件数、模型）。没有问题时显示肯定的结论。
- 问题列表：按严重度或按文件分组；每条显示严重度与类别 chip、标题、`路径:行`、说明、建议（可折叠）。点位置 → 右栏 diff 打开该文件并滚动到该行、行背景高亮；diff 行号旁按严重度显示圆点，点圆点在行下展开问题卡。
- 每条有「选入修复」复选框（默认勾选阻断与严重）；底部固定栏「已选 n 个问题 · 据此修复」。
- 审查记录保留（随项目删除），同一对象可多次审查；提交列表上显示该提交最近一次审查的徽标（「3 个问题」/「无问题」）。
- 不做设计稿的「接受 / 忽略 / 误报」标记（没有后续动作消费这些标记）。

### 4.6 据此修复

不做设计稿的「一键修复 → 隔离副本 → 校验 → 提交 → 推送 → 合并」专用流程：任务流水线本来就是「独立分支与 worktree 中修改 → 检查 → 用户合并或建 PR」。「据此修复」打开开始任务页并预填：项目、流程「修 Bug」、需求（所选问题的渲染：严重度、标题、位置、说明、建议）；基础分支默认为项目默认分支，可在开始任务页的更多选项中改。这与代码审查任务结果卡的「据此修复」（13 §3.4）是同一个入口。工作区改动的审查不提供据此修复（未提交的改动不在任何分支上），按钮禁用并说明「先提交，再审查提交」。

## 5. 与主工作区、任务 worktree 的边界

| 对象 | 工作台能做什么 |
| --- | --- |
| 主工作区（`projects.repoPath`） | 全部手动操作的执行地点：暂存、提交、切换、拉取、在其中合并（目标是它检出的分支时） |
| 任务 worktree（本应用创建的） | **只读**：Worktree 视图列出状态；「清理遗留 worktree」只删终态任务的（已有）。工作台不在其中执行任何命令 |
| 进行中任务的分支（任务状态不是 `completed` / `cancelled`） | **只读**：浏览、比较、AI 审查可以；切换、删除、推送、作为合并的来源或目标 → `GIT_BRANCH_OWNED_BY_TASK`，界面上这些按钮禁用并链接到任务页（任务分支的合并与推送只走交付） |
| 已结束任务的分支 | 与用户自己的分支相同（可删除、合并、推送） |
| 其他 worktree（用户自己建的） | 只读列出；检出在其中的分支不能切换到、不能删除（`GIT_BRANCH_IN_USE`） |
| 远端 | 获取、拉取、推送（不强推）、建 PR；不删除远端分支 |

「进行中」用任务状态判断：`completed` 的任务在 PR 审查意见回流（21）时可以回到 `running`，但它依赖的是 origin 上的 PR 分支（21 §4.1 会从 origin 恢复本地分支），用户在工作台删除这个本地分支不影响它。

主工作区有进行中的合并 / 变基 / cherry-pick（用户在终端做了一半）时，写操作返回 `GIT_OPERATION_IN_PROGRESS`，页头显示「主工作区有未完成的合并」并给出终端命令（`git merge --continue` / `--abort`）；工作台不替用户继续或中止。

## 6. 界面（D110）

只在专业模式（侧栏「Git」，与现在一致）。简单模式不变：简单模式的用户经任务结果卡合并，不需要直接操作 Git。

### 6.1 仓库概览 `/git`

顶部一句说明（「查看项目的提交与分支，提交、推送与合并你自己的改动；让 AI 只读审查」）；每个项目一张卡：名称与路径、当前分支 chip、领先 / 落后、未提交改动数、最近提交（标题、作者、相对时间）、最近一次审查的问题数、远端绑定状态；「进入」。读取失败的项目卡显示原因（路径不存在 → 去项目页）。

### 6.2 仓库工作台 `/git/:projectId`

内容区占满（不用页面的最大宽度），三栏各自滚动：

- **页头工具条**：面包屑「Git / 项目 ▾」（下拉切换项目）、分支 chip ▾（切换 / 新建分支）、领先 n · 落后 m、「n 个未提交改动」chip（点击进入改动视图）、主工作区进行中的合并提示；右侧「获取」（显示上次获取时间，取 `FETCH_HEAD` 的修改时间）、「拉取」、「推送」、更多 ▾（合并到当前分支…、在平台打开）。
- **左栏（220px）**：视图切换「改动 n / 提交 / 分支 / Worktree」；提交视图的筛选（分支、作者、搜索标题或 SHA）；本地分支与远端分支的快捷列表（当前分支标记、任务分支带任务编号）。1280 宽以下收成图标条。
- **中栏（380px）**：提交列表按日期分组（今天 / 昨天 / 日期），每行：标题、HEAD 与分支标签 chip、审查徽标；第二行作者首字头像、作者、相对时间、短 SHA；左侧简化图谱（最多 3 条泳道，合并提交画合流点；由父提交关系在前端计算，纯函数单测）。滚到底自动加载更早的提交。
- **右栏**：提交详情。标题与正文；键值网格（作者、提交者（与作者相同时省略）、SHA + 复制、父提交（合并提交可切换对比的父）、所在分支、改动 n 个文件 +a −d 与比例条）；主按钮「AI 审查此提交」。页签「改动文件 n」（文件树 + diff：统一 / 并排、忽略空白、全宽阅读）与「AI 审查」（§4.5，有记录时显示问题数）。

### 6.3 改动视图

左栏换成文件列表：「已暂存」与「未暂存」两组（未跟踪文件在未暂存组里标「新」），每行状态字母、路径、+a −d，悬停出现暂存 / 取消暂存；组标题上「全部暂存」「全部取消」。中栏与右栏合并为 diff（选中文件的工作区 vs 暂存区 或 暂存区 vs HEAD）+ 右侧提交面板：标题、正文、「AI 草拟」、作者行、提交按钮（下拉「提交并推送」）、「AI 审查改动」。

### 6.4 分支视图

表格：分支（当前、远端、任务编号与状态）、上游与领先落后、相对默认分支的领先落后、最近提交（标题、作者、时间）、行操作菜单（§3.4）。表格上方「新建分支」「比较两个分支」。

### 6.5 对话框

- 合并：来源 → 目标，两种方式单选卡（说明各自结果），不可用时禁用并写明原因（目标检出且有改动、目标是任务分支），压缩时的提交信息与「AI 草拟」，按钮「合并」。冲突时对话框变为冲突说明：冲突文件、「交给 AI 解决」「我自己处理」。
- 推送：分支 → origin、将推送的提交列表、「不会强推」。
- 删除分支：分支、是否已合并；未合并时第二步说明会丢失的提交数。
- 创建 PR：标题（默认最近一个提交的标题）、描述（默认提交列表）、目标分支。

### 6.6 视觉

全部用现有主题令牌与 `base.css` 的尺度（06 §8），不加新令牌；四套主题走查。图谱泳道颜色用 `accent` / `ok` / `warn` 系列令牌；严重度用 `bad` / `warn` / `sub`。

## 7. 接口、数据与枚举

### 7.1 操作（11 §8 增补）

已有的读操作保留；`git.status` 增加 `operation`（`merge | rebase | cherry_pick | revert | null`）、`identity`（`{ name, email } | null`）、`fetchedAt`；`git.log` 增加 `author`、`search`；`git.commit` 增加 `parent`（选择对比的父）、`committer*`、`branches`（包含该提交的本地分支）；新增 `git.changes`（`{ staged, unstaged }`）与 `git.changeFile`（`?path&side`）、`git.pushPreview`（推送确认用）。完整路径见 11 §8。

| 操作 | 方法与路径 | 风险 | 助手 |
| --- | --- | --- | --- |
| `git.stage` / `git.unstage` | `POST /projects/:id/git/stage`、`/unstage` `{ paths }` | write | 是 |
| `git.changes` / `git.changeFile` | `GET /projects/:id/git/changes`、`/changes/file?path&side` | read | 是 |
| `git.pushPreview` | `GET /projects/:id/git/push?branch` | read | 是 |
| `git.createCommit` | `POST /projects/:id/git/commits` `{ message }` → 新提交 | write | 是 |
| `git.draftCommitMessage` | `POST /projects/:id/git/commit-message` `{ staged: true } \| { from, to }` → `{ subject, body }` | read | 否（界面辅助） |
| `git.push` | `POST /projects/:id/git/push` `{ branch }` | critical | 是 |
| `git.pull` | `POST /projects/:id/git/pull` | write | 是 |
| `git.createBranch` | `POST /projects/:id/git/branches` `{ name, startPoint, switch }` | write | 是 |
| `git.switchBranch` | `POST /projects/:id/git/switch` `{ branch }` | write | 是 |
| `git.deleteBranch` | `DELETE /projects/:id/git/branches/:name?force` | critical | 是 |
| `git.merge` | `POST /projects/:id/git/merge` `{ source, target, strategy, message? }` → `{ merged: true, commit } \| { merged: false, conflictFiles }` | critical | 是 |
| `git.mergeWithAi` | `POST /projects/:id/git/merge-task` `{ source, target }` → 任务（`produces: task`） | write | 是 |
| `git.createPullRequest` | `POST /projects/:id/git/pull-requests` `{ branch, base, title, body }` → `{ url, existed }` | critical | 是 |
| `gitReviews.start` | `POST /projects/:id/git/reviews` `{ target, focus? }` → 审查（`produces: git_review`） | write | 是 |
| `gitReviews.list` / `get` | `GET /projects/:id/git/reviews?to`、`GET /git/reviews/:reviewId` | read | 是 |
| `gitReviews.stop` | `POST /git/reviews/:reviewId/stop` | write | 是 |

全部 `mode = pro`（D65 ①：简单模式下助手看不到这些工具）。助手调用 write 出现确认卡片（可「总是允许」），critical 每次确认（D27）。

### 7.2 数据（10 增补）

`git_reviews`：`id`、`project_id`（级联删除）、`target_kind`（`worktree | commit | branch | range`）、`label`（分支名或短 SHA，显示用）、`from_sha`、`to_sha`（工作区改动为空）、`focus`、`attempt_id`、`files`（JSON：开始时的改动文件清单）、`summary`、`findings`（JSON）、`created_at`、`finished_at`。状态取其尝试的状态（同 `knowledge_turns`），不另设状态列与状态机。

### 7.3 AI 草拟提交信息

`AttemptKind.CommitMessage`，不属于任务、不计并发；只读会话（同审查的权限），首条消息含 `git diff --cached --stat` 与截断到 `COMMIT_DRAFT_DIFF_MAX_BYTES`（60 KB）的 diff（合并时为 `merge-base..来源` 的 diff 与提交标题列表），要求按仓库最近提交的风格写；MCP 工具 `submit_commit_message({ subject, body? })`。操作等待尝试结束后直接返回草稿（通常 10–20 秒，按钮显示进行中，可取消 = 中止尝试）；失败返回 `COMMIT_DRAFT_FAILED`（原因）。草稿只填进输入框，用户改完再点提交。

### 7.4 枚举与错误码（08 增补）

- `AttemptKind`：`git_review`、`commit_message`；`SessionAgent`：`code_reviewer`；`EntityKind`：`git_review`；SSE：`git_review.updated`。
- 错误码：`GIT_NOTHING_TO_COMMIT` 409、`GIT_IDENTITY_MISSING` 400、`GIT_OPERATION_IN_PROGRESS` 409、`GIT_PUSH_REJECTED` 409、`GIT_NO_UPSTREAM` 409、`GIT_BRANCH_EXISTS` 409、`GIT_BRANCH_IN_USE` 409、`GIT_BRANCH_NOT_MERGED` 409、`GIT_BRANCH_OWNED_BY_TASK` 409（`details.task`）、`GIT_REVIEW_NOT_FOUND` 404、`GIT_REVIEW_RUNNING` 409、`GIT_REVIEW_FINDINGS_INVALID`（MCP，`details.problems`）、`COMMIT_DRAFT_FAILED` 502。复用：`WORKTREE_DIRTY`（`details: { path, files }`）、`BRANCH_DIVERGED`、`HOSTING_NOT_CONFIGURED`、`HOSTING_AUTH_FAILED`、`OPENCODE_NOT_READY`。

## 8. 不做

- 设计稿的「一键修复」专用流程（`ai-fix/*` 分支、修复副本、按文件撤销、修复后校验）：由「据此修复」开普通任务代替（§4.6）。
- 合并请求列表、流水线状态、评审人指派、保护分支检测：需要按平台分别读取，工作台以本地仓库为主；建 PR 后给链接。
- 审查问题的接受 / 忽略 / 误报标记、审查维度与职业选择。
- diff「展开上下文 20 行 / 全部」：需要按需读取文件全文并与 hunk 拼接，`DiffBrowser` 现在只渲染 unified diff；留作后续。
- 回执未知、核对原操作（D11）。
- §3.1 末尾列出的 Git 操作。

## 9. 测试（07）

- 集成（真实 Git 临时仓库 + bare 远端，`createTestRepo`）：每个写操作一个成功路径 + 其特有错误码；提交用用户身份且运行钩子（测试仓库放一个拒绝的 `pre-commit`）；推送被拒；拉取不能快进；合并两种方式与冲突（目标不变）；任务分支被拒（`GIT_BRANCH_OWNED_BY_TASK`）；合并任务的准备阶段留下冲突标记；与任务交付并发时经仓库锁串行。
- 集成（FakeOpencode）：审查的 `submit_findings` 成功、`PATH_NOT_IN_DIFF` 后修正重提、非审查尝试调用被拒；草拟提交信息成功与失败。
- 单元：图谱泳道计算、`--porcelain` 推送结果解析、状态的暂存 / 未暂存拆分。
- E2E **J24**（`pro-git.browser.spec.ts`）：专业模式 → 工作台 → 改动视图暂存一个文件 →「AI 草拟」填入草稿 → 提交 → 新建分支并切换 → 再提交 → 「AI 审查」该分支（FakeOpencode 提交两个问题）→ 点问题位置，diff 打开到该行 →「合并到 main」（压缩，确认）→ 推送 main（确认）→ bare 远端的 main 有该提交；另一用例：合并冲突 →「交给 AI 解决」→ 任务完成后在结果卡合并 → main 有解决后的内容。J9 的走查改为截工作台的提交、改动、分支、审查结果与合并对话框。

## 10. 实现拆分（确认后）

1. 后端 Git 写操作与扩展的读操作（`modules/git` 新增 `git.write.ts`、`git.branches.ts`；`delivery.merge.ts` 的合并参数化身份）、操作契约与文档（08 / 11）。
2. 合并任务：`merge_branch` 内置流程与准备阶段的合并（`tasks`、`builtin`、13）。
3. 审查与草拟：`modules/git-review`（表、迁移、服务、操作）、尝试类型与 agent、MCP 工具 `submit_findings` / `submit_commit_message`、提示词（10 / 12）。
4. 前端：工作台外壳与三栏、提交列表与图谱、提交详情、改动视图、分支视图、对话框、审查面板；copy 在 `web/src/copy/git.ts`。
5. 测试与 J24、J9 走查更新。
