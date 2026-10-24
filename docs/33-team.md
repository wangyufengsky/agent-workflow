# 33 · 团队

> 状态：**设计稿，未实施**（2026-10-24）。用户已确认的方向：组长看组员；**不做评分**，做成图表，支持同一成员不同时间段的纵向对比和成员之间的横向对比；一个项目就是一个团队，页面跟着项目切换；不纳入 PR / MR 评审数据。默认统计本地分支、可切换；任务提交加发起人 trailer（D130）。实现细节按推荐方案（D128–D131），待用户检查。任务拆分见 [05](05-dev-plan.md) 的 T 系列。

## 1. 定位

回答组长的三个问题：**这段时间每个人在做什么、做了多少、做得怎么样。**

- **团队 = 项目**：成员是项目仓库里的提交作者，不另建团队、不邀请成员、不登录账号。页面顶部切换项目，团队随之切换。与「不做多人协作、云端同步」（04 §5.3）不冲突：只读本机的 Git 历史，数据不离开本机（AI 分析除外，§6.6）。
- **只读**：不改仓库，不改任务与流程的状态。
- **不评分、不排名**（D128）：没有综合分、等级、排行榜。每个指标单独成图，写明口径；横向对比表默认按姓名排序，用户点列头才按数值排序。理由：提交量、行数很容易被刷，也容易被 AI 撑大；单一分数会让大家去优化分数；AI 直接给个人打绩效分，被评的人很难接受，也涉及《个人信息保护法》第 24 条对自动化决策的要求。
- **如实**：没有数据显示「—」与原因；识别不了的情况（如没有标记的 AI 生成代码）在界面上说明，不估算。
- **不做**按小时的活跃热力图、工时推算、加班统计（§10）：这些不能说明工作做得好不好，属于对个人的监控。

## 2. 数据从哪里来

### 2.1 读哪个分支

- 默认读项目的**本地默认分支**（用户 2026-10-24 决定）；工具条可切换为任意本地或远端分支（如 `origin/main`：成员推送了但本地还没拉取的工作在那里）。
- 页头写明「数据截至 <分支> 的最新提交（时间）· 上次获取 <时间>」，旁边「获取」按钮复用 Git 工作台的获取操作（27 §3.1）。不自动获取。

### 2.2 计入的提交

| 规则 | 说明 |
| --- | --- |
| 从所选分支可达 | `git rev-list <ref>`；只看进了这个分支的工作 |
| 不含合并提交 | 合并提交的改动已经算在被合并的提交里；squash 合并只有一个普通提交，照常计入，作者是 squash 时写的作者 |
| 时间用作者时间 | `%at`：变基、cherry-pick 不改作者时间，比提交时间更接近「什么时候写的」 |
| 作者身份 | `%aN` / `%aE`，已应用仓库的 `.mailmap`；再按 §2.3 的成员设置合并 |

### 2.3 成员

- 每个作者邮箱（小写）是一个**身份**。系统自动把每个身份当作一个成员。
- 组长可以：**合并身份**（同一个人的公司邮箱和个人邮箱）、**改显示名**、**设为非成员**（机器人、CI 账号，如 `dependabot[bot]`）。设置按项目保存（`team_identities`，§8.2）。
- 本应用 AI 任务的提交作者是 `agent-workflow <agent-workflow@localhost>`（D52）。这些提交默认归入「AI 任务」，不算任何成员；任务提交带 §2.5 的发起人 trailer 时，归到发起人名下的「经 AI 任务」一栏。
- 非成员（含「AI 任务」）在成员表下方单独列出，默认折叠，不进入团队合计与中位数。

### 2.4 排除规则（口径设置）

改动行数排除以下文件，规则按项目保存，修改后立即重算（文件级数据已缓存，§7）：

- **默认排除**：锁文件（`pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`Cargo.lock`、`go.sum`、`poetry.lock`、`composer.lock`、`Gemfile.lock`）、构建与依赖目录（`dist/`、`build/`、`out/`、`vendor/`、`node_modules/`）、`*.min.js`、`*.map`、`*.snap`、二进制文件（numstat 为 `-`，只计文件数）。
- **自定义排除**：glob 列表（如 `src/generated/**`）。
- **超大提交**：有效改动行（增 + 删）超过 `TEAM_HUGE_COMMIT_LINES`（默认 5 000，可改）的提交，行数不计入，提交照常计数；界面注明「n 个超大提交未计行数」，可在提交列表中查看。用于排除一次性导入代码、批量格式化。
- **测试文件**（只用于 §3.2 测试伴随率，不排除）：`**/*.test.*`、`**/*.spec.*`、`**/test/**`、`**/tests/**`、`**/__tests__/**`、`**/*_test.go`、`**/test_*.py`、`src/test/**`；可改。

### 2.5 识别 AI 参与（D130）

只能识别带标记的提交，没有标记的 AI 生成代码识别不了，界面写明。

| 标记 | 来源 |
| --- | --- |
| 作者是 `agent-workflow@localhost` | 本应用的任务提交、任务交付的合并提交 |
| trailer `Agent-Workflow-Requested-By: 名字 <邮箱>` | **新增**（D130，用户已确认）：本应用的任务提交写上发起人（任务开始时项目仓库的 `git config user.name / user.email`）。只对加入后的提交有效，旧提交仍只归入「AI 任务」 |
| trailer `Co-Authored-By:` 的名字或邮箱含已知 AI 工具 | Claude、Copilot、Cursor、Codex、Gemini、Devin、aider 等（列表 `TEAM_AI_COAUTHOR_PATTERNS`），由其他工具写入 |

成员页的「AI 参与」= 该成员名下带上述任一标记的提交占比；「经 AI 任务」= 带本应用发起人 trailer、归到他名下的提交数。

## 3. 指标

时间段内、每个成员各算一组。纵向对比用同一组指标按时间分桶；横向对比把成员并排。

### 3.1 产出

| 指标 | 计算 | 备注 |
| --- | --- | --- |
| 提交数 | 计入的提交条数 | |
| 活跃天数 | 有提交的日期数（`AppDeps.timeZone` 下的自然日，同 19 §2.2） | |
| 新增 / 删除行 | 有效文件（§2.4）的 numstat 之和，不含超大提交 | 图上与表头都注明「行数受代码风格与 AI 影响，仅作参考」 |
| 涉及文件数 | 改过的有效文件去重数 | |
| 提交大小 | 每个提交有效改动行的**中位数** | 小而清楚的提交更易审查与回滚；不加好坏判断 |
| 工作构成 | 按提交标题分类（§3.3），各类的提交数 | |
| 改动分布 | 按路径前两级目录汇总有效改动行，取前 10 | 看每个人在哪些模块上工作 |

### 3.2 质量信号（不调用 AI）

| 指标 | 计算 | 分母为 0 时 |
| --- | --- | --- |
| 测试伴随率 | 改了非测试有效文件的提交中，同时改了测试文件的比例 | — |
| 被回滚 | 该成员在时间段内的提交，之后被所选分支上某个提交以 `This reverts commit <sha>` 回滚的条数 | 0 |
| 修复占比 | 工作构成中「修复」类的占比 | — |

「修复占比」只描述工作内容（修自己的还是别人的 Bug 看不出来），不作为质量好坏，界面这样写明。

### 3.3 工作构成的分类

按提交标题的约定式前缀 `type(scope)!:`，再加少量中文前缀：

| 类别（`TeamWorkType`） | 前缀 |
| --- | --- |
| `feature` 功能 | `feat`、`新增`、`添加`、`实现` |
| `fix` 修复 | `fix`、`bugfix`、`hotfix`、`修复`、`修正` |
| `test` 测试 | `test`、`测试` |
| `refactor` 重构与性能 | `refactor`、`perf`、`重构`、`优化` |
| `docs` 文档 | `docs`、`文档` |
| `chore` 工程与杂项 | `build`、`ci`、`chore`、`style`、`revert` |
| `other` 未标注 | 其余 |

### 3.4 对比

- **纵向**：成员页的每个指标按时间分桶（§4.2）；指标卡显示与**上一个同长度时间段**相比的变化（如「↑ 12%」），上一段没有数据时不显示。
- **横向**：团队页的成员表与「成员对比」图；每个指标给出团队**中位数**作参照线（只算时间段内至少有一个提交的成员）。
- **AI 抽样评审**（§6）的结果只在同一时间段、同一分支都做过分析的成员之间横向比较；没做过的显示「未分析」。

## 4. 时间段与分桶

### 4.1 时间段（`TeamPeriod`）

| 值 | 范围（含首尾两天） |
| --- | --- |
| `last_30_days` | 今天及之前 29 天（默认） |
| `last_90_days` | 今天及之前 89 天 |
| `last_180_days` | 今天及之前 179 天 |
| `last_365_days` | 今天及之前 364 天 |
| `custom` | `from`、`to`（`YYYY-MM-DD`），`from ≤ to`，最多 `TEAM_MAX_DAYS`（731）天；否则 `VALIDATION_FAILED` |

日期换算复用 `insights.period.ts`（时区参数化的纯函数，19 §7），不另写一份。

### 4.2 分桶（`TeamGranularity`）

`day` / `week`（周一开始） / `month`。默认按时间段长度：≤ 31 天按天，≤ 180 天按周，更长按月；用户可改，但分桶数超过 `TEAM_MAX_BUCKETS`（120）时该选项禁用。没有提交的桶也有点（全 0）。

## 5. 页面

导航「团队」（图标 `users`），两种模式都显示（D128）：这是组长要用的功能，不属于任务流程的专业细节。专业模式额外显示口径设置与提交明细（§5.4）。

### 5.1 路由

| 路由 | 页面 |
| --- | --- |
| `/team` | 跳到上次看的项目；没有记录时跳到第一个项目 |
| `/team/:projectId` | 团队概览 |
| `/team/:projectId/members/:memberKey` | 成员页（`memberKey` = 成员主身份的邮箱，URL 编码） |

时间段、分桶、分支写在地址 `?period=&from=&to=&granularity=&ref=`，项目切换时保留。

### 5.2 团队概览

自上而下：

1. **页头工具条**：面包屑「团队 / 项目 ▾」（下拉切换项目，同 Git 工作台 27 §6.2）、分支 ▾、时间段分段控件、分桶；右侧数据截至与「获取」（§2.1）。
2. **首次读取**：没有缓存时显示进度「正在读取提交历史 n / m」（§7.2），读完前不显示图表。
3. **团队合计卡**：提交数、活跃成员数、有效新增 / 删除行、测试伴随率；带上一段对比。
4. **团队趋势**：按桶的提交数柱状图，按成员堆叠（成员超过 8 个时其余合并为「其他」）。
5. **成员表**：每行一个成员——头像首字、显示名、提交数、活跃天数、新增 / 删除行（比例小横条）、提交大小中位数、测试伴随率、被回滚、AI 参与、AI 抽样评审（§6.5，未分析为「—」）。表头下一行为团队中位数。默认按显示名排序，点列头按该列排序。点行进入成员页。
6. **成员对比**：选一个指标（下拉），每个成员一根柱，带中位数参照线。
7. **模块分布**：前 10 个目录 × 成员的改动行比例条，看每个模块主要是谁在改。
8. **非成员**（折叠）：「AI 任务」、机器人等的提交数与行数。
9. **AI 分析**：「为全部成员生成分析」（确认框写明成员数、每人最多抽样几个提交、大致用量，§6.4）。

### 5.3 成员页

1. **页头**：显示名、身份邮箱列表、「合并身份…」「改显示名」「设为非成员」；工具条与团队页相同。
2. **指标卡**：§3.1、§3.2 的各项，带上一段对比与团队中位数。
3. **纵向趋势**：提交数柱状图；新增 / 删除行堆叠柱状图；测试伴随率按桶的柱状图。
4. **工作构成**：比例条 + 各类数字。
5. **改动分布**：前 10 个目录的横条。
6. **AI 分析**（§6）：最近一次分析的报告；历史分析列表（时间段、分支、时间）；「生成分析」按钮。
7. **提交列表**：标题、时间、有效改动、分类、标记（超大 / 被回滚 / AI）；点提交在 Git 工作台打开该提交（27 §6.2）。

### 5.4 专业模式增补

- 团队页「口径设置」抽屉：排除规则、测试文件规则、超大提交阈值（§2.4），附「恢复默认」。
- 成员表可展开每个指标的计算明细（如被回滚的是哪几个提交）。

### 5.5 状态与视觉

- 加载中（骨架）、读取失败（`ErrorState`，如路径不存在 → 去项目页、分支不存在 → 改分支）、这段时间没有提交（`EmptyState`「这段时间没有提交」）。
- 图表沿用 D80 的自写 HTML/CSS 柱状图，新增「分组柱」「比例条」两个组件，不引入图表库；颜色用主题令牌，成员颜色按序取 `--accent`、`--role-2`… 系列；每张图下附同样数据的隐藏表格供读屏（同 19 §3.2）。四套主题走查。

## 6. AI 成员分析（D131）

### 6.1 产出

一次分析针对**一个成员、一个时间段、一个分支**，产出：

- **工作总结**：这段时间做了哪几件事（按主题归纳），每件事附相关提交；
- **亮点**与**值得关注的地方**：各最多 5 条，每条必须附提交作证据；
- **抽样评审**：后端选出的几个提交里的代码问题，结构同 `submit_findings`（27 §4.4），多一个所属提交。

**不产出分数、等级、排名**；提示词要求只写有提交为据的观察，不推断性格、态度、工作时长。

### 6.2 抽样

后端选出该成员在时间段内有效改动行最多的提交，跳过有效改动超过 `TEAM_REVIEW_MAX_LINES`（2 000）行的，最多 `TEAM_ANALYSIS_SAMPLE`（5）个。没有可抽样的提交时不评审，只写总结。抽样清单存在分析记录上，结果页写明「抽样评审了这 n 个提交，共 m 行」。

### 6.3 会话

- `AttemptKind.TeamAnalysis`，不属于任务（同 `git_review`，27 §4.3）；agent `aw-team-analyst`：权限与 `aw-code-reviewer` 相同（只读 bash 白名单、无编辑与联网），会话目录 = 项目主仓库；模型取内置 `reviewer` 角色。
- 首条消息给出：成员的身份、时间段、分支；提交清单（SHA、日期、标题、有效改动，最多 400 条，更多时给出按周的汇总并说明）；§3 的指标；抽样提交及其读取方式（`git show <sha>`）。
- 模型用 MCP 工具 `submit_member_analysis`（§6.6）提交；只允许 `team_analysis` 尝试调用。

### 6.4 排队

- 一个项目同一时间只运行一个分析，其余排队；不计入调度器并发（同 D68）。「为全部成员生成」一次建好每个成员的分析记录并排队。
- 状态（`TeamAnalysisStatus`，09 增补）：`queued` → `running` → `succeeded` / `failed`；`queued` / `running` 可取消 → `cancelled`。重启时 `running` 的分析按尝试的中断规则记为 `failed`（`interrupted`），可「重新生成」；`queued` 的继续排队。
- 同一成员、时间段、分支已有 `queued` / `running` 的分析时再发起 → `TEAM_ANALYSIS_EXISTS`。
- 分析记录保留（随项目删除）；成员合并身份后，旧分析仍挂在原主身份的邮箱下，界面一并列出。

### 6.5 质量数字

由抽样评审的问题算出，只在有分析的成员上显示：

- **每千行问题数**：问题数 ÷ 抽样提交的有效改动行 × 1 000，按严重度（阻断 / 严重 / 一般）分开；
- **问题类别分布**：正确性 / 安全 / 性能 / 可维护性 / 测试。

成员表的「AI 抽样评审」列显示阻断 + 严重的每千行问题数，悬停看全部。抽样只有几个提交，界面注明「抽样结果，样本小，仅作参考」。

### 6.6 MCP 工具 `submit_member_analysis`

```ts
{
  summary: string;                          // 总体概述，1..2000，Markdown
  work_items: Array<{                       // 1..15
    title: string;                          // 1..120
    description: string;                    // 1..1000，Markdown
    commits: string[];                      // 1..50，完整 SHA，须在本次的提交清单中
  }>;
  strengths: Array<{ text: string; commits: string[] }>;   // 0..5；text 1..500，commits 1..20
  concerns: Array<{ text: string; commits: string[] }>;    // 0..5；同上
  findings: Array<{                         // 0..30
    commit: string;                         // 须在抽样清单中
    severity: 'blocker' | 'major' | 'minor';
    category: 'correctness' | 'security' | 'performance' | 'maintainability' | 'tests';
    path: string;                           // 须在该提交的改动文件中
    line?: number; end_line?: number; side?: 'new' | 'old';
    title: string; description: string; suggestion?: string;   // 长度限制同 submit_findings
  }>;
}
```

校验不通过 → `TEAM_ANALYSIS_INVALID`，`details.problems[]`（`COMMIT_NOT_IN_PERIOD`、`COMMIT_NOT_SAMPLED`、`PATH_NOT_IN_COMMIT`、`LINE_OUT_OF_RANGE`），每项带给模型的 hint，模型修正后重提（同 `submit_findings`）。通过 → 写入分析记录，尝试 `succeeded`，发 `team_analysis.updated`。

**隐私**：分析会把该成员的提交与代码发给所配置的模型。第一次在某个项目上生成分析时，确认框写明这一点。

## 7. 缓存与性能（D129）

### 7.1 缓存不可变的提交事实

提交按 SHA 不会变，缓存只存提交本身的事实，不存「属于哪个分支」：

- `team_commits`：作者身份、显示名、作者时间、标题、trailer 解析出的标记（§2.5）、回滚的目标 SHA（`This reverts commit` 中的）。
- `team_commit_files`：每个提交每个文件的 numstat（路径、增、删、是否二进制）。

排除规则、测试规则、成员设置都在查询时套用，修改后不用重新读 Git。

### 7.2 读取

- 打开团队页时：`git rev-list --no-merges <ref>` 得到可达的提交（十万级提交约百毫秒级，实现时实测），与缓存求差，缺的用 `git log --no-walk --numstat -z --format=...` 分批读入（每批 500 个，解析复用 `git.diff.ts` 的 numstat 解析）。
- 分支被强推或换分支不影响缓存：可达集合每次现算，已缓存的提交直接复用。
- 首次读取大仓库可能需要十几秒到一分钟：后台进行，经 SSE `team.scan.updated` 报进度；同一项目同时只有一次读取，再打开页面时接着显示进度。
- 聚合在后端一次完成：按可达集合与时间段取缓存行，在 JS 中按时区分桶、套规则、汇总（同 19 §5）。

### 7.3 索引

`team_commits(project_id, authored_at)`、`team_commit_files(project_id, sha)`；主键 `(project_id, sha)` 与 `(project_id, sha, path)`。

### 7.4 目标

在 5 万提交、20 万文件行的仓库上，缓存就绪后 `last_365_days` 的概览 ≤ 300 ms（T-02 实测记录在本节）。

## 8. 接口、数据与枚举（实施时迁入 08–12）

### 8.1 操作（11 增补）

| 方法 | 路径 | 操作 | risk | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/projects/:id/team?ref&period&from&to&granularity` | `team.summary` | read | 概览：数据截至、读取进度、团队合计、按桶趋势、成员行、中位数、非成员、模块分布 |
| GET | `/projects/:id/team/members/:memberKey?…` | `team.member` | read | 成员页：指标与上一段对比、按桶趋势、工作构成、改动分布、分析列表 |
| GET | `/projects/:id/team/commits?member&…&cursor` | `team.commits` | read | 提交列表（分页） |
| PUT | `/projects/:id/team/identities` | `team.identities.update` | write | 合并身份、改显示名、设为非成员 |
| GET / PUT | `/projects/:id/team/settings` | `team.settings.get` / `update` | read / write | 排除规则、测试规则、超大提交阈值 |
| POST | `/projects/:id/team/analyses` | `team.analyses.create` | write | `{ members: string[], ref, period, from?, to? }`，返回建好的分析 |
| GET | `/team/analyses/:id` | `team.analyses.get` | read | 分析记录与报告 |
| POST | `/team/analyses/:id/cancel` | `team.analyses.cancel` | write | 取消排队或运行中的分析 |

全部 `mode = simple`，`team.settings.update` 为 `mode = pro`。应用助手能用 read 操作回答「张三这个月提交了多少」；`team.analyses.create` 是 write，弹确认卡。`open_page` 增加 `team`。

### 8.2 表（10 增补，迁移 `0023_team`）

| 表 | 列 |
| --- | --- |
| `team_commits` | `project_id`、`sha`、`author_email`、`author_name`、`authored_at`、`subject`、`ai_marks`（JSON：`task` / `requested_by` / `coauthor`）、`requested_by_email`、`reverts_sha` |
| `team_commit_files` | `project_id`、`sha`、`path`、`added`、`deleted`、`binary` |
| `team_identities` | `project_id`、`email`、`member_email`（合并到的主身份）、`display_name`、`hidden` |
| `team_settings` | `project_id`、`exclude_globs`、`test_globs`、`huge_commit_lines`（JSON 或列，空 = 默认） |
| `team_analyses` | `id`、`project_id`、`member_email`、`ref`、`ref_sha`（开始时的分支提交）、`period_from`、`period_to`、`status`、`sample`（JSON SHA 列表）、`attempt_id`、`report`（JSON）、`error`、`created_at`、`finished_at` |

### 8.3 枚举、常量与错误码（08 增补）

- `TeamPeriod`、`TeamGranularity`、`TeamWorkType`、`TeamAnalysisStatus`；`AttemptKind` 增加 `team_analysis`；`AssistantPage` 增加 `team`。
- `TEAM_MAX_DAYS = 731`、`TEAM_MAX_BUCKETS = 120`、`TEAM_HUGE_COMMIT_LINES = 5000`（默认）、`TEAM_REVIEW_MAX_LINES = 2000`、`TEAM_ANALYSIS_SAMPLE = 5`、`TEAM_AI_COAUTHOR_PATTERNS`、默认排除与测试 glob。
- 错误码：`TEAM_ANALYSIS_EXISTS`、`TEAM_ANALYSIS_INVALID`；分支不存在复用 Git 工作台的错误码。

### 8.4 任务提交的发起人 trailer（D130）

`nodes.run.ts` 的节点提交与 `delivery.merge.ts` 的 squash / 合并提交，在提交信息末尾加 `Agent-Workflow-Requested-By: 名字 <邮箱>`。名字与邮箱在任务开始时从项目仓库读 `git config user.name` / `user.email` 存到任务上；读不到时不加。作者与提交者仍是 `GIT_COMMIT_IDENTITY`（D52 不变）。

## 9. 实现结构

- `shared/enums/team.ts`、`shared/contracts/api/team.ts`、`shared/operations/team.ts`。
- `server/modules/team/`：
  - `team.scan.ts`：可达集合与缓存求差、分批读入、进度；
  - `team.parse.ts`：日志格式、trailer、约定式前缀、回滚目标（纯函数）；
  - `team.aggregate.ts`：套规则、分桶、§3 全部指标、中位数、上一段对比（纯函数）；
  - `team.analysis.ts`：抽样、首条消息、排队、`submit_member_analysis` 校验；
  - `team.repo.ts`、`team.service.ts`、`team.operations.ts`、`index.ts`。
- `web/src/features/team/`：概览页、成员页、口径设置抽屉、分组柱与比例条组件、查询；文案 `web/src/copy/team.ts`。

## 10. 不做

- 综合评分、等级、排行榜、绩效结论（D128）。
- 按小时的活跃热力图、工时与加班推算。
- PR / MR 评审数据（用户决定，2026-10-24）。
- 跨项目汇总一个人的工作（团队 = 项目）。
- 代码归属与返工率（基于 `git blame`，需要对全仓库逐文件计算，成本高）：留作后续，确认后再设计。
- 自动获取、定时生成分析（可以用定时任务另行确认）。
- 导出报告。

## 11. 测试（07）

| 层 | 测什么 |
| --- | --- |
| 单元 `team.parse.test.ts` | 约定式前缀与中文前缀分类；`Co-Authored-By` 与发起人 trailer；`This reverts commit` 解析；numstat 二进制与改名 |
| 单元 `team.aggregate.test.ts` | 空数据（比率为空、每桶都有点）；排除规则与超大提交；测试伴随率分母；被回滚归到原作者；身份合并与非成员不进中位数；三种分桶与上一段对比；`agent-workflow` 作者归入 AI 任务、带 trailer 的归到发起人 |
| 集成 `team.int.test.ts` | 真实 Git 仓库：三个作者（其中一个两个邮箱 + `.mailmap`）、一个锁文件提交、一个回滚、一个机器人；经 API 取概览与成员页的数字；强推后可达集合变化、缓存复用；改排除规则立即生效；读取进度事件 |
| 集成（分析） | FakeOpencode 调用 `submit_member_analysis`：引用了时间段外的提交、未抽样的提交、不在提交中的路径各被拒并带 hint；修正后成功；两个成员排队依次运行；取消排队中的分析 |
| 集成（trailer） | 任务跑完后节点提交与 squash 提交带发起人 trailer；仓库没有配置 `user.email` 时不加 |
| E2E `team.browser.spec.ts`（J35） | 种子仓库打开团队页：成员表数字、默认按姓名排序、点列头排序；切换项目与时间段；成员页纵向趋势；合并身份后数字合并；FakeOpencode 生成一次分析并显示报告；四套主题无报错 |
| live | 免费模型对一个种子仓库的成员生成分析，引用都通过校验 |
