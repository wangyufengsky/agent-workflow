# 41 · 内置 skill

> 状态：**已确认，SK-01–SK-04 已实现**（2026-10-27，用户要求：「我们需要哪些 skill，skill 如何写，以及如何注入」；同日补充：「AI 助手是否需要 skill？她的主观能动性最高」，助手因此作为 skill 的主要使用者单列，§5.1）。决策 D206–D212 同日按推荐方案确认（02），任务拆分见 05 的 SK。§3 的 opencode 行为在 opencode 1.19.0 上实测（2026-10-27），标注「读代码」的条目尚未实测，由 §9 的测试兜住。

## 1. 为什么要有

**提示词是全量常驻的。** 每个 agent 的协议提示词（`packages/builtin/prompts/protocol-*.md`，合计约 26 KB）在会话开始时整篇进入系统提示词。真正每次都要遵守的规则必须放在这里；而只在少数对话或任务里才用得上的做法知识（任务为什么失败该怎么查、数据库排查的步骤、合并冲突的处理、Word / Excel 怎么写得好），放进去会让每个会话都为它付出上下文，不放又没有地方写。

skill 是按需加载的知识包：会话里只列出名字和一句描述，模型判断用得上时调用 `skill` 工具，才读入正文。它正好放这类长尾知识。

**助手最需要它。** 执行者、评审者的范围由应用给定：一步的指令、验收、上下文都已确定。助手是开放式对话，一次对话只用到她能力中的一小部分，却要为全部能力的说明付出上下文：`protocol-assistant.md` 约 6.3 KB，是所有协议里最大的，而且每上线一个功能就多一段（需求计划约 1.3 KB、画图约 0.9 KB、预览与浏览器、团队分析）。她的决定（建什么任务、需求怎么写、选哪个流程）决定后面整条链路的质量，中间没有评审把关，最需要好的做法知识。

**现在 aw 的会话已经在加载 skill，只是不是我们的。** opencode 默认扫描 `~/.claude/skills`、`~/.agents/skills` 和项目里的同名目录，并把找到的 skill 列给每个会话。在一台开发机上实测：任意项目的 aw 会话都会列出用户个人目录下的 49 个 skill，外加嵌套在某个 `node_modules` 里被扫到的 3 个，仅描述就约 1 万字符；还有 opencode 自带的 `customize-opencode`。这些 skill 是用户为别的工作写的，多数面向编码（写测试、实现规格、交接），内容可能与执行协议冲突，却会出现在执行者、评审者和助手的会话里；对能建任务、发确认的助手影响最大。

## 2. 范围

| 做 | 不做 |
| --- | --- |
| 应用自带一组 skill（`packages/builtin/skills/`），随安装包发布，opencode 启动时通过配置注入 | 走 MCP 的 Skills 扩展（SEP-2640，见 D206） |
| 每个 agent 只看到分配给它的 skill；用户个人的 skill、项目仓库里的 skill 在 aw 会话中不出现 | 项目仓库里的 skill（`.agents/skills`、`.claude/skills`、`.opencode/skills`）与用户给助手加的 skill：需要时另行设计，见 §10 |
| 助手的 7 个 skill（§5.1），其中 2 个由现有提示词段落迁移而来；任务会话的 3 个 skill（§5.2） | 用户在应用里新建或编辑 skill |
| 协议提示词在明确的触发点点名 skill | 把必须遵守的规则移进 skill（D208） |
| | `skills.urls`（远程 skill 列表）、skill 带附带文件（D209） |

## 3. opencode 的 skill 机制（1.19.0）

| 事实 | 依据 |
| --- | --- |
| skill 是目录下的 `SKILL.md`，YAML 头里有 `name` 与 `description`；正文是 Markdown | 实测 |
| 来源依次为：opencode 自带的 `customize-opencode`；`~/.claude/skills`、`~/.agents/skills`；从会话目录向上到 worktree 根的 `.claude/skills`、`.agents/skills`；配置目录（全局 opencode 配置目录与项目的 `.opencode/`）下的 `skill(s)/**/SKILL.md`；配置 `skills.paths` 里每个目录下的 `**/SKILL.md`；`skills.urls` | 实测（全局 opencode 配置目录一项为读代码） |
| `skills.paths` 的绝对路径原样使用，相对路径按会话目录（任务的 worktree）解析，`~/` 开头按用户主目录解析 | 实测 |
| 环境变量 `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` 跳过全局与项目里的 `.claude`、`.agents` 两类目录，`.opencode/skills` 与 `skills.paths` 不受影响 | 实测 |
| 扫描按目录进行：某个目录第一次用到 skill 时扫描并缓存，之后新增的文件看不到；`POST /instance/dispose?directory=` 清掉缓存后重新扫描 | 实测 |
| 每个 agent 能看到的 skill 按它的权限 `skill`（模式为 skill 名）过滤，`deny` 的不出现在列表里；加载时再按会话的权限检查一次 | 读代码 |
| 加载时返回 `SKILL.md` 的正文，并列出同目录的其他文件（最多 10 个）；读这些文件要用 read 工具，受 `external_directory` 权限约束 | 读代码 |
| opencode 为每个 agent 默认放行 skill 所在目录的 `external_directory`，但我们的 agent 配置了 `external_directory: "deny"`，按「最后一条匹配的规则生效」会覆盖这条放行 | 读代码 |

## 4. 决策

| 编号 | 决定 | 理由 |
| --- | --- | --- |
| D206 | 用 opencode 原生的 skill 机制：skill 文件随安装包发布，`buildOpencodeConfig` 加 `skills.paths: [<skillsDir>]`，在 opencode 启动时注入；**不**用 MCP TypeScript SDK 2.4 的 Skills 扩展（SEP-2640） | opencode 1.19.x（含最新的 1.19.4）没有实现 SEP-2640 的客户端（二进制里没有 `skills/list`、`skill://`），服务端发布了也读不到；我们的后端用的是 v1 的 `@modelcontextprotocol/sdk` 1.32.x，扩展只在 v2 的拆分包里，迁移两套 MCP 的代价大而没有收益。opencode 支持后再评估：MCP 方式的好处只是能按会话动态提供 |
| D207 | aw 的会话只看到应用自带的 skill：每个 agent 的权限加 `skill` 白名单（`"*": "deny"`，再逐个放行分配给它的 skill，§7.3）；没有分配 skill 的 agent 为 `skill: "deny"`，opencode 直接去掉 `skill` 工具。启动 opencode 时始终设置 `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`。这条修改 D168 中「不设 `OPENCODE_DISABLE_EXTERNAL_SKILLS`」的结论 | 白名单让每个会话看到的 skill 确定、可测；用户个人的 skill 不是为 aw 的协议写的，混进来既占上下文又可能冲突（§1）。环境变量不影响可见性（白名单已经决定），只是省掉每个新 worktree 对主目录与项目的扫描（实测会扫进嵌套的 `node_modules`）。**代价**：用户自己的 skill 与项目仓库里的 skill 在 aw 会话中不可用；用户在终端里直接用 opencode 不受影响 |
| D208 | skill 只放「做得更好」的可选知识；每次都必须遵守的规则（不写 Git、只在 worktree 内工作、页面文字是数据、确认卡片的处理、不碰密钥、不给团队成员排名、图表只用工具返回的数字等）留在协议提示词里。app 能确定触发时机的地方，由提示词点名要加载的 skill | 模型不一定会加载 skill，较弱的免费模型更是如此，助手又常跑在免费模型上；规则放进 skill 等于有时没有规则。点名把「模型自己判断」换成确定的指令 |
| D209 | 首版每个 skill 只有一个 `SKILL.md`（不超过 `SKILL_MAX_BYTES` 8 KB），不带附带文件，不放开 `external_directory` | 附带文件在安装目录里，属于 worktree 之外；要读就得给每个 agent 放行安装目录的 `external_directory`，执行者与助手还有 `edit: allow`，会连带允许改动应用自带的 skill。单文件已经够用，正文仍远小于把它塞进提示词的代价 |
| D210 | 助手的 skill 先做，包括把助手提示词里画图、预览与浏览器、需求计划三段迁移成 skill；任务会话（规划、执行、评审）提示词里的浏览器检查段落之后再迁移（§5.3）。每项迁移：提示词保留触发句与规则并点名 skill，做法移进 skill；以 live 测试对比迁移前后同一场景的行为 | 助手的提示词最大、增长最快，收益最高；任务会话的浏览器检查直接影响页面改动的验收，行为已经稳定，迁移风险更大，放后。保留触发句让迁移后「什么时候做」不变，变的只是「怎么做」的说明何时读入 |
| D211 | skill 用英文写，与协议提示词一致；静态文件，不做 `{{}}` 模板替换；名字用 `aw-` 前缀，与目录名相同 | opencode 直接读文件，没有渲染这一步，动态信息由工具和对话上下文提供；英文是提示词的既有约定（文档与界面才用中文）；前缀让白名单与用户自己的 skill 不会重名 |
| D212 | 每个 agent 分配的 skill 不超过 `AGENT_SKILLS_MAX` 8 个；超过时先合并相近的 skill | 模型靠列表里的描述决定加载哪个，列表越长越容易选错或漏选；每条描述也在每个会话里占上下文。助手自主性最高、能力最多，最容易越过这个数 |

## 5. 需要哪些 skill

### 5.1 助手

| skill | 来源 | 何时加载 | 内容要点 |
| --- | --- | --- | --- |
| `aw-task-requirement` | 新增，并入提示词的需求计划段 | 建任务、批量任务、定时任务、需求计划之前（点名） | 把用户的话写成规划者能直接用的需求：目标与背景、范围与「不做」、可观察的验收标准、约束（不能改的接口、不能加的依赖）、涉及的文件 / 页面 / 链接；信息不够时先在对话里问哪几项、哪些可以合理假设并写进需求；按 `workflows_list` 的说明选流程；一个任务还是需求计划的判断（多个功能、要分阶段、给了需求文档），需求计划的模板、草稿确认与重新拆解（原提示词段落）；好坏需求各一例 |
| `aw-task-diagnosis` | 新增 | 用户问任务为什么失败、为什么卡住、下一步该怎么办 | 按顺序查：`tasks_get`（状态、当前步骤、等你处理的条目）→ `tasks_timeline`（哪一步、第几次尝试出的问题）→ `nodes_get`（失败步骤的验收输出：检查命令的输出、页面体检的失败项、AI 评审的问题）→ 运行环境（`system_runtime`、`system_runtimeLogs`：opencode 没起来、模型登录失效或额度用完）→ `system_environment`（Git、opencode 缺失）。把原因归到一类：需求不清、检查发现的代码缺陷、环境问题（预览起不来、网络）、模型或登录问题、在等用户。引用真实的报错行，不猜。按原因给下一步并用对应工具：回答待处理的问题、带具体意见「再改改」（`tasks_requestChanges`）、重试步骤（`nodes_retry`）、重启运行环境（`system_restartRuntime`）、改检查命令（`tasks_updateCheckCommand`）；跳过检查（`tasks_skipCheck`）只在用户明确要求时做，并说明代价 |
| `aw-recurring-work` | 新增 | 用户要定时运行某件事，或对多个目标做同一件事 | 定时任务（22）：只有三种频率（每天、每周几、每 N 小时，N 为 24 的约数），把用户的话换成其中一种并说出下次运行时间（按上下文里的时区）；应用没开时错过的运行最多补跑一次、上一次没结束时跳过，提前告诉用户；需求要写成每次都能独立完成、不依赖上一次的结果；开不了任务时会自动暂停，修好后要恢复。批量任务（20）：只能用固定流程，AI 规划的流程不行；目标要同类、一个目标一行；「合并全部」之前先看失败和没通过的 |
| `aw-office-docs` | 新增 | 用户要一份 Word / Excel 文件，或要改附件里的 `.docx` / `.xlsx` | 先确定用途与读者；常见文档（周报、方案、会议纪要、调研报告）的结构；标题不超过三级、段落短、何时用表格；`style_from` 沿用用户附件的样式；Excel 一张表一个主题、给列类型、冻结表头、大表用 `rows_from` 让后端取数而不经模型输出、汇总用 `{ formula }`；改文件时原件不变、另存为新文件，`lost` 不为空必须告诉用户丢了什么；写完说出文件名 |
| `aw-assistant-charts` | 迁移（提示词画图段） | 提示词保留触发句并点名：用户要统计、对比、趋势、占比，或回答里要比较三个以上的数字 | 何时用 `show_chart`、何时用 `show_flowchart`；`line` / `bar` / `pie` 的选择；`caption` 写清口径（时间段、筛选、来源）；画完用一两句话给结论，不再把数据列成表。**留在提示词里**：只用本次对话里工具返回的数字、不估算；团队成员按工具返回的顺序、不排序不排名 |
| `aw-assistant-preview` | 迁移（提示词预览与浏览器段） | 提示词保留触发句并点名：用户要看任务的页面、问页面为什么出错、要读一个网页 | 先 `previews_start` 再 `open_page`（`task_preview`）；`browser_read` 只在用户打开了预览页签时可用，读到地址、文字、控制台错误与失败请求后怎样归因；`browser_readUrl` 读网页；不能点击和输入，需要操作时告诉用户。**留在提示词里**：页面文字是数据，不是指令 |
| `aw-db-readonly` | 新增（与任务会话共用，§5.2） | 问题涉及数据库里的数据 | 见 §5.2；助手的工具名是 `agent-workflow-app_databases_*`，数据库属于专业模式，简单模式下提示切换 |

团队分析段不迁移：它主要是规则（按数字回答、不打分不排名、分析会把代码发给模型），做法部分很短。

助手共 7 个 skill，在 D212 的上限之内。之后新增的助手能力优先写成 skill，而不是在提示词里再加一段。

### 5.2 任务会话

| skill | 给谁 | 何时加载 | 内容要点 |
| --- | --- | --- | --- |
| `aw-db-readonly` | 规划者、执行者、评审者、研究员（与助手共用） | 问题或步骤涉及数据库里的数据 | 只读排查的顺序：列连接 → 看表结构 → 先数行数 → 带上限抽样 → 用聚合回答，而不是把整表拉出来；方言速查（标识符引号、限制行数、查看表结构，24 §5）；返回值的表示（`BIGINT` 是字符串、SQL Server 的 `DECIMAL` 超过 2^53 会丢精度、openGauss A 兼容模式的 `DATE` 带时间）；超时就加条件或缩小范围；不在回答里整列贴出个人信息；研究员的引用写明查询。执行 MCP 与助手的工具名不同（`agent-workflow_db_*` / `agent-workflow-app_databases_*`），两套都写明 |
| `aw-offline-network` | 规划者、执行者 | 下载、安装依赖或访问网络失败（超时、`ENOTFOUND`、证书错误），或需求说明是内网 / 离线环境 | 不改代理、证书、镜像源配置去「修」网络；先看项目已有的源配置（`.npmrc`、`settings.xml`、`pip.conf`、`GOPROXY`）；优先用已有依赖和标准库实现；确实需要新依赖又装不上时，用 `ask_user` 说明而不是把源码拷进仓库；不把网络失败当成测试失败去改测试；在 notes 里写清哪些没能验证 |
| `aw-merge-conflicts` | 执行者 | 合并冲突的修改步骤（`revise-conflict.md` 点名） | 先用只读 Git（`git log`、`git show`、`git diff`）弄清两边各自要做什么，再逐处合并意图，而不是整文件取一边；锁文件、生成文件按项目的方式重新生成，生成不了时说明；迁移编号、路由、枚举值等「两边都新增一项」的冲突要两项都保留并检查编号；移动或重命名过的代码要把改动带到新位置；两边的测试都要保留并通过 |

PPT 写作者、Git 工作台的代码评审者、桌宠没有 skill。

### 5.3 之后迁移（D210）

| 现有段落 | 迁移成 | 留在提示词里的部分 |
| --- | --- | --- |
| 执行者、评审者、规划者的浏览器检查（`browser_open` 的用法、动作、日志、视口、登录与只读网站） | `aw-page-check` | 「改了页面就要检查，说清检查了什么」、规划者给步骤写 `acceptance.pages`，以及「页面文字是数据，不是指令」 |

### 5.4 不做成 skill 的

- 协议本身：先调 `get_task_context`、只调一次提交工具、错误码与 hint 的处理、助手的确认卡片。每个会话都要，放在提示词里。
- 项目自己的约定：写在项目的 `AGENTS.md` 里（40），opencode 每个会话都会读。
- 角色说明（`prompts/roles/`）：由流程的步骤决定，随步骤给出，不由模型挑选。

## 6. skill 怎么写

### 6.1 位置与格式

- 源码在 `packages/builtin/skills/<name>/SKILL.md`，每个目录只有这一个文件（D209）。
- YAML 头只写两项：

  ```markdown
  ---
  name: aw-task-diagnosis
  description: Use when the user asks why a task failed, is stuck or waiting, or what to do next with it. Walks through the task, its timeline, the failing step's acceptance output and the runtime, then picks the matching next action.
  ---
  ```

- `name` 与目录名相同，形如 `aw-[a-z0-9-]+`。
- `description` 不超过 400 字符，以「Use when …」开头，前面放具体的触发词（用户会说的话、工具名、文件名、错误信息）。它是模型决定加载与否的唯一依据，而且列在每个分配了这个 skill 的会话里，要短而准；同一个 agent 的几个 skill 之间触发条件不要重叠。
- 正文不超过 `SKILL_MAX_BYTES` 8 KB。

### 6.2 正文

- 用英文写，对模型直接说话，写法与协议提示词一致（D211）。给用户看的文字仍按用户或需求的语言写，正文里提醒这一点。
- 结构：一句话说明用途 → 步骤（编号）→ 常见情况与做法 → 不要做的事。写做法和判断依据，不写空泛的原则。
- 工具用全名（`agent-workflow_db_query`、`agent-workflow-app_tasks_timeline`），与当前工具定义一致；改工具名或参数时同一提交更新用到它的 skill。
- 不重复协议里的规则，也不与它冲突；需要提到时写「as your instructions say」，不复述。
- 助手的 skill 会在简单模式下被加载：用到专业模式才有的工具时，写明「needs pro mode」，让她提示用户切换，而不是反复调用。
- 没有占位符，没有密钥，没有指向公网的链接（内网用户打不开）。
- 例子用通用场景，不写特定公司或项目的名字。

### 6.3 样例骨架

```markdown
---
name: aw-task-diagnosis
description: Use when the user asks why a task failed, is stuck or waiting, or what to do next with it. Walks through the task, its timeline, the failing step's acceptance output and the runtime, then picks the matching next action.
---

Find the actual cause before you suggest anything, and quote the line that shows it.

## Steps

1. `agent-workflow-app_tasks_get`: the task's state, its current step and the items waiting for the user.
2. `agent-workflow-app_tasks_timeline`: which step and which attempt went wrong.
3. ...

## Causes and next steps

- The check command failed on the code: ...
- The model's login expired or its quota ran out: ...

## Do not

- Skip a check unless the user asks for it.
- ...
```

## 7. 如何注入

### 7.1 文件与路径

| 处 | 改动 |
| --- | --- |
| `packages/builtin/skills/` | skill 源码 |
| `packages/builtin/src/skills.ts` | `SkillName`（`aw-*` 名字的常量，与 `PromptName` 同处管理）、`SKILL_MAX_BYTES`、`AGENT_SKILLS_MAX` |
| `packages/server/src/core/config.ts` | `AppConfig.skillsDir`；环境变量 `AW_SKILLS_DIR`，缺省为源码里的 `packages/builtin/skills`（同 `promptsDir`） |
| `apps/desktop/src/main/backend.ts` | 打包后 `AW_SKILLS_DIR = <resourcesPath>/skills`，开发时指向源码目录 |
| `apps/desktop/electron-builder.yml` | `extraResources` 加 `../../packages/builtin/skills` → `skills` |

### 7.2 配置与环境变量

`buildOpencodeConfig`（`modules/opencode/opencode.config.ts`）增加：

```jsonc
{
  "skills": { "paths": ["<skillsDir>"] },
  "agent": {
    "aw-assistant": {
      "permission": {
        // …原有权限不变
        "skill": {
          "*": "deny",
          "aw-task-requirement": "allow", "aw-task-diagnosis": "allow", "aw-recurring-work": "allow",
          "aw-office-docs": "allow", "aw-assistant-charts": "allow", "aw-assistant-preview": "allow", "aw-db-readonly": "allow"
        }
      }
    },
    "aw-slides": { "permission": { /* … */ "skill": "deny" } }
  }
}
```

- `"*": "deny"` 写在最前：opencode 取最后一条匹配的规则（与 bash 规则相同，12 §2）。
- `opencodeLaunchEnv` 始终加 `OPENCODE_DISABLE_EXTERNAL_SKILLS: '1'`（D207），不只在离线时。
- 经 `OPENCODE_CONFIG_CONTENT` 注入的 `skills.paths` 会替换用户自己配置里的同名数组（与 D168 记下的 `disabled_providers` 相同）。白名单下用户的 skill 本来就不可见，没有额外影响。

### 7.3 分配表

一处定义：`opencode.config.ts` 里与 `AGENT_PERMISSION` 并列的 `AGENT_SKILLS: Record<SessionAgent, SkillName[]>`，另加助手的一份。权限的 `skill` 规则由它生成。

| skill | 规划者 | 执行者 | 评审者 | 研究员 | PPT | 代码评审 | 助手 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aw-task-requirement` | | | | | | | ✓ |
| `aw-task-diagnosis` | | | | | | | ✓ |
| `aw-recurring-work` | | | | | | | ✓ |
| `aw-office-docs` | | | | | | | ✓ |
| `aw-assistant-charts` | | | | | | | ✓ |
| `aw-assistant-preview` | | | | | | | ✓ |
| `aw-db-readonly` | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `aw-offline-network` | ✓ | ✓ | | | | | |
| `aw-merge-conflicts` | | ✓ | | | | | |

桌宠的 agent 已经是 `'*': 'deny'`，不变。

### 7.4 提示词里的点名（D208、D210）

- `protocol-assistant.md`：
  - 建任务、批量任务、定时任务或需求计划之前，先加载 `aw-task-requirement`；需求计划一段缩成触发句与规则（草稿要用户在页面上确认，助手不改阶段与工作包）。
  - 画图一段缩成触发句与规则，并点名 `aw-assistant-charts`。
  - 预览与浏览器一段缩成触发句与规则，并点名 `aw-assistant-preview`。
- `revise-conflict.md`：先加载 `aw-merge-conflicts`。

其余 skill（`aw-task-diagnosis`、`aw-recurring-work`、`aw-office-docs`、`aw-db-readonly`、`aw-offline-network`）靠描述触发，不点名。

### 7.5 生效与更新

- opencode 启动时注入路径（应用启动、设置页的「立即重启」、意外退出后的自动重启都会重新注入）。
- skill 文件随应用升级更新，升级后应用重启，opencode 随之重启，不需要清缓存。
- 开发时改了 `SKILL.md`，新建的任务或助手对话（新的目录）就能读到新内容；已经在跑的会话继续用缓存。
- 不涉及表结构、状态机、REST API 与 MCP 工具（10、09、11、12 §3 以后不变）。12 §2 的配置示例补上 `skills` 与各 agent 的 `skill` 权限，D168 的说明补一句指向 D207；15 §2 补一句助手的 skill 与 41 的链接。

## 8. 安全

- skill 正文是应用自带的静态文件，与协议提示词同等可信；不读取项目或用户提供的 skill（D207），仓库里的 `SKILL.md` 不会被当作指令加载。
- 白名单在 agent 级配置里，会话无法自行放开；`skill` 工具加载时 opencode 还会按会话权限再检查一次。
- 不放开 `external_directory`（D209），执行者与助手不能读写安装目录。
- skill 只教做法，不改变工具的风险等级：助手照 skill 去调用的写操作仍然出确认卡片（15 §2）。

## 9. 测试（07）

| 层 | 内容 |
| --- | --- |
| 单元 | `packages/builtin` 的 skill 检查：每个目录只有 `SKILL.md`；YAML 头可解析，`name` 与目录名相同且带 `aw-` 前缀，`description` 非空且不超过 400 字符；文件不超过 `SKILL_MAX_BYTES`；`SkillName` 与目录一一对应。`opencode.config.test.ts` 的快照：`skills.paths`、各 agent 的 `skill` 规则（`"*": "deny"` 在最前）、没有 skill 的 agent 为 `deny`、每个 agent 不超过 `AGENT_SKILLS_MAX`；启动环境里有 `OPENCODE_DISABLE_EXTERNAL_SKILLS` |
| oc（真实 opencode，不调模型） | 按应用的配置启动托管的 opencode，在临时仓库的 `.agents/skills` 与 `.claude/skills` 下各放一个 skill：`GET /skill?directory=<临时仓库>` 包含全部 `aw-*`，不包含这两个（同一开关也跳过用户主目录下的，实测；改 `HOME` 会影响找 opencode，不在测试里做）。agent 级过滤：本地的 OpenAI 兼容服务代替模型（同 `opencode.permissions.oc.test.ts`），记下每个 agent 一轮对话里 opencode 发给模型的请求：分配了 skill 的 agent 有 `skill` 工具，请求里出现的 skill 名正好是它的白名单；没有分配的没有 `skill` 工具；仓库里的与 opencode 自带的 `customize-opencode` 都不出现 |
| live（免费模型） | 解决合并冲突（`live/merge-conflicts.live.test.ts`）：真实任务到待验收后 main 改同几行，交付冲突，交给 AI 解决：会话加载了 `aw-merge-conflicts`，文件里没有冲突标记、两边的改动都在，之后能合并。助手建任务（`live/skills.live.test.ts`）：会话记录里在 `tasks_create` 之前有加载 `aw-task-requirement` 的 `skill` 调用（agent 级过滤由上一行的 oc 测试覆盖，不再经模型观察）。助手诊断：一个检查命令必定失败的任务停下后问「为什么失败」，回答引用了检查输出。迁移对比：画图与预览各沿用 35、29 已有的 live 场景，迁移前后各跑一次，模型仍然画出图、仍然先启动预览再打开 |
| 打包 | `skills` 与 `prompts` 走同一条 `extraResources`；`pnpm e2e:smoke` 跑的是未打包的应用，覆盖不到，改为实现时手动检查 `electron-builder --dir` 产物的 `Resources/skills` |

## 10. 之后可能做的

- **用户给助手加的 skill**：应用数据目录下一个「我的 skill」目录，只加进助手的 `skills.paths` 与白名单（名字不能用 `aw-` 前缀），设置页的「助手」分组列出并说明怎样添加。适合报告模板、团队的固定说法这类个人知识。比放开 `~/.agents` 安全：只有用户特意放进来的才生效，也只给助手。白名单要按名字放行，需要在 opencode 启动时读出目录里的名字，新加的 skill 重启 opencode 后生效。
- **项目的 skill**：项目设置里加「使用仓库里的 skill」开关，打开后为这个项目放行 `.opencode/skills` 下的 skill。难点是 opencode 1.19 的权限只按 skill 名过滤，分不清项目的与用户个人的，需要换成按项目配置目录注入的方式，届时另行设计。
- **MCP 的 Skills 扩展**：opencode 实现 SEP-2640 的客户端后，再评估是否改为由执行 MCP 按任务动态提供（D206）。

## 11. 实施拆分

| 编号 | 内容 | 测试 |
| --- | --- | --- |
| SK-01 | 机制：`skillsDir` 配置与打包、`skills.paths`、`AGENT_SKILLS` 与 `skill` 权限、`OPENCODE_DISABLE_EXTERNAL_SKILLS`；先放一个 `aw-task-diagnosis`（纯新增，不改现有行为）；更新 12 §2、15 §2 与 D168 的说明 | 单元、oc、打包冒烟 |
| SK-02 | 助手的新 skill：`aw-task-requirement`（含需求计划段的迁移与点名）、`aw-recurring-work`、`aw-office-docs` | 单元、live（建任务） |
| SK-03 | 助手的迁移：`aw-assistant-charts`、`aw-assistant-preview`，每项单独提交 | 每项迁移前后各跑一次对应的 live 场景 |
| SK-04 | 任务会话的 skill：`aw-db-readonly`（同时放行给助手）、`aw-offline-network`、`aw-merge-conflicts` 与 `revise-conflict.md` 的点名 | 单元 |
| SK-05 | 任务会话的浏览器检查迁移成 `aw-page-check`（§5.3） | 迁移前后各跑一次页面改动的 live 场景 |
