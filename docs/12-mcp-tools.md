# 12 · 执行 MCP 工具与 opencode 集成

> 本文描述**执行 MCP**（`/mcp/exec`），供执行开发任务的 AI 会话使用。应用助手使用的**助手 MCP**（v1.1）见 [15-assistant.md](15-assistant.md)，两者令牌与权限隔离。

## 1. 职责边界

- **opencode 原生工具**（read / edit / write / bash / grep / glob …）负责读写代码、跑命令。会话 `directory` = 任务 worktree。
- **本项目 MCP 工具**负责：取上下文、提交计划/结果/评审、向用户提问、上报进度、读任务 diff、数据库只读查询。
- 模型**不做任何 Git 写操作**：节点完成时由后端提交；合并冲突由后端先在 worktree 执行 `git merge <target>`，模型只负责改冲突文件（见 13 的 `revise` 节点）。
- 工具失败返回结构化错误码 + hint，模型据此修正后重试；工具层不做静默兜底。

## 2. 注入到 opencode 的配置

后端启动 opencode 时通过 `OPENCODE_CONFIG_CONTENT` 注入（与用户自己的全局 opencode 配置合并，用户的模型登录/provider 原样复用）：

```jsonc
{
  "mcp": {
    "agent-workflow": {
      "type": "remote",
      "url": "http://127.0.0.1:<apiPort>/mcp/exec",
      "headers": { "Authorization": "Bearer <mcpToken>" },
      "oauth": false,
      "enabled": true
    },
    // v1.1：助手 MCP，令牌另生成（D25）
    "agent-workflow-app": { "type": "remote", "url": "http://127.0.0.1:<apiPort>/mcp/assistant", "headers": { "Authorization": "Bearer <assistantMcpToken>" }, "oauth": false, "enabled": true }
  },
  "plugin": ["file://<appResources>/opencode-plugin/agent-workflow-bridge.js"],
  "agent": {
    "aw-planner":  { "mode": "primary", "description": "agent-workflow planner",  "prompt": "<protocol-plan.md>",    "permission": { "edit": "deny",  "question": "deny", "webfetch": "deny", "external_directory": "deny", "agent-workflow-app_*": "deny" } },
    "aw-executor": { "mode": "primary", "description": "agent-workflow executor", "prompt": "<protocol-execute.md>", "permission": { "edit": "allow", "question": "deny", "webfetch": "ask",  "external_directory": "deny", "agent-workflow-app_*": "deny" } },
    "aw-reviewer": { "mode": "primary", "description": "agent-workflow reviewer", "prompt": "<protocol-review.md>",  "permission": { "edit": "deny",  "question": "deny", "webfetch": "deny", "external_directory": "deny", "agent-workflow-app_*": "deny" } },
    // v1.1 知识研究员（18 §5.1）：只读；网络工具与子 agent 关闭，会话的网络开关打开时会话级规则再放行 webfetch / websearch
    "aw-researcher": { "mode": "primary", "description": "agent-workflow researcher", "prompt": "<protocol-research.md>", "permission": { "edit": "deny", "question": "deny", "webfetch": "deny", "websearch": "deny", "task": "deny", "external_directory": "deny", "agent-workflow-app_*": "deny" } },
    // v1.2 PPT 写作者（23 §7.1）：权限同研究员，没有网络
    "aw-slides": { "mode": "primary", "description": "agent-workflow slides_writer", "prompt": "<protocol-slides.md>", "permission": { "edit": "deny", "question": "deny", "webfetch": "deny", "websearch": "deny", "task": "deny", "external_directory": "deny", "agent-workflow-app_*": "deny" } },
    // v1.1 应用助手（15 §2）：只看到助手 MCP 的工具
    "aw-assistant": { "mode": "primary", "description": "agent-workflow assistant", "prompt": "<protocol-assistant.md>", "permission": { "edit": "allow", "question": "deny", "webfetch": "ask", "external_directory": "deny", "agent-workflow_*": "deny" } }
  },
  "shell": "C:\\Program Files\\Git\\bin\\bash.exe"   // 仅 Windows：Git Bash，bash 规则按 bash 语法匹配（D72）
}
```

- 生成函数 `buildOpencodeConfig`（`modules/opencode/opencode.config.ts`）；agent 的 `prompt` 为 `packages/builtin/prompts/protocol-*.md`，插件路径为构建出的 `agent-workflow-bridge.js`（打包后在 `Resources/opencode-plugin/`，源码运行时在 `packages/opencode-plugin/dist/`）。
- 每个 agent 的权限 deny 另一套 MCP 的工具（`agent-workflow-app_*` / `agent-workflow_*`）：opencode 去掉被整体 deny 的工具，执行任务的会话看不到几十个助手工具，助手也看不到执行工具；即使调用了，归属也会失败（12 §3、15 §2）。
- agent 只放不随设置变化的权限；**bash 规则在 `session.create` 时以会话级 `permission` 规则集传入**（D35，`sessionPermissionRules`），格式 `[{ permission: 'bash', pattern, action }]`。opencode 取**最后一条**匹配的规则，所以兜底的 `*` 放在最前。
- 原生 `question` 工具禁用，提问只走 MCP `ask_user`（D36）。
- **bash 规则集**（`shared/constants/opencode.ts`：planner 与 reviewer 用 `readonlyBashRules(checkCommands, allowedBash)`，executor 按 `ai.bashPolicy` 用 `BASH_PERMISSION_PRESETS`；`allowedBash` 是项目中「总是允许」记下的模式，D101）：
  - Git 只读子命令：`git status* git log* git diff* git show* git blame* git grep* git ls-files* git rev-parse*`。
  - 只读规则，按顺序（最后一条匹配的规则生效）：
    1. `*` ask。
    2. 版本查询 allow（D64）：单条命令 `<程序> --version` / `-version` / `-V`、`go version`；`-v` 只对 `node npm npx pnpm yarn bun mvn gradle docker`（别的程序里 `-v` 常是 verbose，如 `rake -v` 会运行默认任务）。程序名前还有别的词（`rm -rf src --version`、`PATH=. node --version`）或程序是路径（`./deploy.sh --version`）时 ask；`npx <包> --version` 也 ask（没有 TTY 时 npx 默认 `--yes`，会下载并运行任意包），只有 `npx --version` 本身放行。
    3. 只读白名单 allow：`ls* cat* head* tail* rg* grep* find* wc* echo* pwd which*` 与 Git 只读子命令（D61）；以及（D100，写成 `X *`，`du` 不会顺带放行 `dump`）文本过滤 `sort` `uniq`（只带 `-` 开头的参数，第二个文件参数是输出）`cut` `tr` `nl` `awk`、只打印的 `sed -n`（脚本以 `p` 结尾）、归档与类文件列表 `unzip -l` `unzip -Z` `jar tf` / `tvf` / `-tf` / `-tvf` / `--list` `javap`、文件信息 `file` `stat` `du` `tree` `diff`、查找 `command -v` / `-V` `type` `basename` `dirname` `realpath` `readlink`。`xargs`、`env`、`sh -c`、`command <程序>` 等会运行任意命令的不放行；前置环境变量（`PATH=… mvn -v`）仍询问（D64）。
    4. 同一工具的测试命令 allow（只在有检查命令的只读会话，D64）：检查命令以下列工具开头时放行对应的测试写法，该工具的其他子命令（`mvn deploy`、`npm publish`、`npm install`）不放行：
       - npm / pnpm / yarn / bun / node：`npm test`、`npm run test`、`npm t`、`pnpm test`、`pnpm run test`、`yarn test`、`yarn run test`、`bun run test`、`node --test`、`pnpm vitest run`、`pnpm exec vitest run`，可带任意参数。
       - `npx vitest` / `npx jest`：只有检查命令本身用 npx 运行该工具时才放行 `npx vitest run` / `npx jest`（可带任意参数）；npx 在项目没装该包时会下载并运行它。
       - mvn / ./mvnw：`mvn` / `./mvnw` + 可选的 `-q`、`-o`（任意顺序）+ `test`；./gradlew / gradle：`test` 与 `-q test`。之后**只能跟一个以 `-` 开头的参数**（`mvn test -Dtest=Foo#bar`），Gradle 还可以是 `--tests <过滤>`：再多一个词可能是另一个阶段或任务（`mvn test deploy`、`mvn -q test install`、`./gradlew test publish`），通配符分不清它和第二个参数，所以第二个参数也询问（`mvn test -Dtest=X -o`）。用这两个工具的检查命令本身也按这个形状放行，不再是 `<checkCommand>*`（因此 `mvn -q test > f` 也询问）。
       - go：`go test`，可带任意参数，但 `-exec` / `-toolexec`（用别的程序代替测试二进制或编译器）在第 7 步之后仍 ask。
       - pytest / python / python3：`pytest`、`python -m pytest`、`python3 -m pytest`，可带任意参数。
    4a. 项目中总是允许的模式 allow（D101，`project_bash_rules`，如 `./scripts/mvn.sh *`）：排在逃逸写法之前，所以带重定向等写法仍询问。
    5. 逃逸写法 ask（D63、D100）：任何重定向（`*>*`，也包括 `2>&1`、`2>/dev/null`）、`find` 的 `-exec` / `-execdir` / `-ok` / `-okdir` / `-delete` / `-fprint*` / `-fls`、`rg --pre`、`git … --output`、`git grep -O` / `--open-files-in-pager`；`sed` 的 `-i` / `-I`（原地修改）、`-f`（脚本来自文件）、`-e`（后续脚本），以及脚本中的 `w` / `W`（写文件）/ `e`（执行）——通配符解析不了脚本，所以这三个字母出现在无引号脚本结尾的 `p` 之前、或出现在引号内时都询问（地址正则含这些字母时会多问）；`awk` 的 `system`、`|`（管道到命令或 `"cmd" | getline`）、`-f` / `-E` / `--exec` / `-i` / `-l` / `@load`（程序或库来自文件）；`sort -o` / `--output` / `--compress-program`；`uniq` 的第二个参数；`javap -J`（JVM 选项可加载 agent）；`file -C` / `--compile`；`tree -o` / `-R`。
    6. 第 2、3、4、4a 步的命令后接结尾单独的 ` 2>&1` 或 ` 2>/dev/null` 再 allow（`java -version` 把版本打到 stderr，模型常写 `mvn test 2>&1 | tail`、`ls ~/.m2 2>/dev/null`；两者都不写文件，D100），随后 `*>*>*` ask：再有第二个重定向（`mvn test > f 2>&1`）仍询问。
    7. 项目检查命令本身 allow（`<checkCommand>*`，带参数或重定向也放行；Maven / Gradle 的检查命令除外，见第 4 步；评审会话还包括被评审节点验收中的命令检查，即 `$PROJECT_CHECK` 展开后的命令）：运行检查是只读角色了解代码状态的常规手段，询问会频繁打扰用户（D51）。规划与评审会话、以及只读角色执行的步骤（如代码审查流程中评审者的步骤）都带检查命令。
    8. 第 5 步的命令逃逸（重定向除外）再 ask 一遍，使第 6 步的结尾重定向带不进它们（`find . -delete 2>/dev/null`）；然后是测试工具自己的逃逸参数 ask（D64）：`go test *-exec*`、`go test *-toolexec*`，排在检查命令之后，所以检查命令 `go test ./...` 也带不进 `-exec`。
  - `node -e`、`python -c`、`bash -c`、`sh -c` 等内联脚本始终 ask；规划者与评审者的协议提示词要求用项目测试命令或读文件来验证，不写临时脚本、不建临时文件（D64）。
  - opencode 1.19 对每条子命令（tree-sitter 的 `command` 节点，文本含其重定向）单独匹配，`X *` 形式的规则也匹配 `X` 本身，任一子命令不是 allow 就询问；单测 `server/modules/opencode/opencode.permissions.test.ts` 按此语义校验，live `permissions.live.test.ts` 在真实 opencode 上验证（含 `java -version && rm …` 中的 `rm` 仍询问）。
  - `ai.bashPolicy = auto`（默认）：`*` allow；`git *` deny（其他所有 Git 命令都可能改动 refs 或工作区，不逐个列举）；Git 只读子命令再 allow。
  - `ai.bashPolicy = ask`：不带检查命令的只读规则（第 1–3、4a、5、6、8 步）。
  - **项目级「总是允许」**（D101）：opencode 的「总是允许」只对当前会话生效。用户在「需要你处理」中对 bash 请求选「总是允许」时，后端在回复 opencode 之外，把 opencode 随请求给出的 `always` 模式（每条子命令按其命令前缀加 ` *`，如 `unzip -l x.jar` → `unzip *`、`./scripts/mvn.sh -q test` → `./scripts/mvn.sh *`、`mvn -q test` → `mvn -q *`）记到该尝试所属项目（`attempts.project_id`）的 `project_bash_rules`；Git 开头的模式不记（模型不写 Git，12 §1），只留在 opencode 的会话里。项目之后新建的只读会话（规划、评审、研究员、PPT 写作者，以及 `ask` 策略的执行者）带上这些模式（第 4a、6 步）；`auto` 策略的执行者本来就放行 Git 以外的命令，规则不变。已在运行的会话不受撤销影响（D35）。没有项目的调试运行不记。
- 知识研究员（v1.1，18 §5.1）的会话级规则：不带检查命令的 `readonlyBashRules()`；对话打开网络检索时末尾再加 `webfetch *` 与 `websearch *` allow（agent 规则在前、会话规则在后，最后匹配生效；被整体 deny 的工具不出现在工具列表中，见 §8）。会话目录为项目主仓库，不建 worktree。
- PPT 写作者（v1.2，23 §7.1）的会话级规则：不带检查命令的 `readonlyBashRules()`，没有网络；会话目录为项目仓库，没有项目时为 `<数据目录>/ppt/blank/`。
- 角色差异不靠多个 agent：会话使用角色的 `base_agent` 对应的 agent（与尝试类型无关：只读的「代码审查」步骤以 reviewer 身份执行 `execute` 尝试，用 `submit_result` 提交报告），角色提示词通过每次 prompt 的 `system` 字段追加，模型通过 prompt 的 `model` 字段指定。因此修改角色无需重启 opencode。评审检查（`review` 尝试）固定使用内置 `reviewer` 角色。
- 修改 `ai.bashPolicy` 对之后新建的会话立即生效，无需重启 opencode。

## 3. 调用归属（哪个尝试在调用工具）

MCP 连接在 opencode 内是全局的，请求头无法区分会话，因此：

- 插件 `agent-workflow-bridge`（S1 已验证，D33）在 `tool.execute.before` 钩子中，对名称以 `agent-workflow_`（执行 MCP）或 `agent-workflow-app_`（助手 MCP，v1.1）开头的工具**原地修改** `output.args.__aw_session = input.sessionID`（给 `output.args` 重新赋值不会生效）。助手 MCP 按该会话找到助手对话（15 §2）。MCP 服务端在 zod 校验前取出该字段，按 `attempts.opencode_session_id` 找到该会话**最新**的尝试：不存在或不在 `starting/running` → `MCP_ATTEMPT_UNRESOLVED`；已 `succeeded` 且调用的是提交类工具（`submit_plan/result/review`）→ `MCP_RESULT_ALREADY_SUBMITTED`。
- 模型在后续调用中可能自己照抄 `__aw_session`，钩子总会用真实 sessionID 覆盖，因此不影响归属。
- 插件按 opencode 的目录实例各加载一次（每个 worktree 一次），实现须无状态。
- 插件以构建后的 JS 随安装包放在 `Resources/opencode-plugin/`（M2-03）。
- 解析失败 → `MCP_ATTEMPT_UNRESOLVED`；工具不允许用于该尝试类型 → `MCP_TOOL_NOT_ALLOWED`。

## 4. 会话协议

### 4.1 尝试开始

1. `POST /session?directory=<worktree>` 创建会话，标题 `<taskKey> · <节点标题>`。
2. `POST /session/{id}/prompt_async?directory=<worktree>`：
   - `agent`：`aw-planner` / `aw-executor` / `aw-reviewer`
   - `model`：角色模型 > 设置 `ai.defaultModel` > 省略（opencode 默认）
   - `system`：角色提示词
   - `parts`：首条消息（模板在 `packages/builtin/prompts/start-<kind>.md`），包含需求、本节点指令、上次失败反馈（如有）、`ask_on_uncertainty` 的当前取值说明，并要求先调用 `get_task_context`。
3. 尝试 `starting → running`。

### 4.2 结束条件

| 情况 | 处理 |
| --- | --- |
| 调用 `submit_plan` / `submit_result` / `submit_review` 成功 | 尝试 `succeeded`；后端随后中止会话的后续生成（若仍在生成） |
| `session.idle` 且有未回答的阻塞问题（或待处理的权限请求） | 尝试保持 `running` 但停止计时，节点 `waiting_input`；全部回答后 `prompt_async` 发送答案（`start-answer.md`，多个答案合成一条），节点回到 `running`，重新计时（D46） |
| `session.idle` 且有已回答但未送达的答案 | 发送答案（会话忙时回答的问题，在下一次空闲时送达） |
| `session.idle` 且未提交、无问题 | 发送提醒（`nudge.md`，按尝试类型填入对应的提交工具名），`nudges+1`；已提醒 `ATTEMPT_MAX_NUDGES` 次仍空闲 → `failed / ATTEMPT_NO_RESULT` |
| `session.error` | `failed / ATTEMPT_SESSION_ERROR`（`details.error` 为 opencode 的错误对象） |
| 超时 | 从 `running` 起 `attempt.timeoutMinutes`：中止会话，`failed / ATTEMPT_TIMEOUT` |
| 用户中止 | `aborted`，中止会话 |
| opencode 进程退出 / 重启、后端重启 | 活动尝试 → `interrupted` |

- 「中止会话的后续生成」在提交工具调用返回（工具片段 `completed`）后执行，因此工具结果仍完整记入会话流。
- 会话创建后、发送首条消息前尝试即进入 `running`，保证首条消息引起的任何事件都能找到活动尝试；首条消息发送失败按 `session_error` 处理，会话创建失败按 `start_failed`。

### 4.3 规划会话的复用

`plan` 类尝试：用户在 `plan_review` 选择「按反馈重新规划」时，在**同一会话**发送反馈消息（`replan.md`）并新建一条 `plan` 类尝试记录指向同一 `opencode_session_id`（上一条已 `succeeded`，归属解析只匹配活动尝试，不冲突）。新尝试立即记录；上一轮在提交后的收尾（中止产生的错误与空闲事件）结束之后才发送反馈，避免这些事件落到新尝试上。固定流程（模板计划）不能重新规划（400 `VALIDATION_FAILED`）。

规划失败（规划尝试未提交、出错、超时或被中止）→ 任务 `failed`（`failedPhase = planning`）；规划尝试因运行时消失中断 → 任务保持 `planning`，调度器在运行时恢复后新开一个规划会话。

## 5. 错误返回格式

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"code\":\"PLAN_INVALID\",\"message\":\"Plan graph is invalid\",\"hint\":\"Fix the listed problems and call submit_plan again.\",\"details\":{\"problems\":[{\"code\":\"CYCLE\",\"message\":\"a -> b -> a\"}]}}" }]
}
```

成功返回：`{ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output }`。

通用 hint（`mcp.registry.ts`，各工具可按错误码覆盖）：`VALIDATION_FAILED` 让模型按 `details.issues` 修正参数；`MCP_ATTEMPT_UNRESOLVED` 让模型结束本轮；`MCP_TOOL_NOT_ALLOWED` 让模型只用指令中提到的工具；`MCP_RESULT_ALREADY_SUBMITTED` 让模型结束本轮。未知工具返回 `NOT_FOUND`；未预期异常返回 `INTERNAL_ERROR` 并记录日志。

## 6. 工具清单

| 工具 | 允许的尝试类型 | 作用 |
| --- | --- | --- |
| `get_task_context` | plan · execute · review | 取完整上下文 |
| `get_node_output` | plan · execute · review | 取某个已完成节点的完整产出 |
| `get_task_diff` | execute · review | 当前 worktree 相对基线的改动 |
| `submit_plan` | plan | 提交计划 |
| `submit_result` | execute | 提交节点结果 |
| `submit_review` | review | 提交评审结论 |
| `ask_user` | plan · execute | 向用户提问 |
| `report_progress` | plan · execute · review · research · deck_outline · deck_slides | 上报一句当前进展 |
| `db_list_connections` | plan · execute · review · research | 列出项目关联的数据库 |
| `db_describe` | plan · execute · review · research | 查看表结构 |
| `db_query` | plan · execute · review · research | 只读查询 |
| `submit_answer` | research | 提交带引用的回答（v1.1 知识问答，18 §6） |
| `submit_outline` | deck_outline | 提交 PPT 大纲与 AI 的理解（v1.2，23 §7.3） |
| `submit_slide` | deck_slides | 按页码提交 PPT 的一页（v1.2，23 §7.3） |

工具名在 opencode 中显示为 `agent-workflow_<name>`（名称常量 `McpToolName`）。输入/输出 schema 位于 `shared/contracts/mcp/<tool>.ts`；下文用 TS 类型描述。

M3 实现了除数据库工具以外的全部工具，数据库工具随 M5-07。调试尝试（开发构建，不属于任务）仍可用 `get_task_context`（返回任务编号 `DEBUG`）、`report_progress`、`submit_result`（直接使尝试 `succeeded`，返回 `next: 'done'`）；调试尝试不属于任何项目，`db_list_connections` 返回空列表，其他数据库工具返回 `DB_CONNECTION_NOT_FOUND`。知识问答的 `research` 尝试（v1.1）用对话的项目；对话的资料范围不含数据库时与调试尝试相同。PPT 的尝试（v1.2）不能用数据库工具与任务工具（`MCP_TOOL_NOT_ALLOWED`）。

---

### 6.1 `get_task_context`

输入：`{}`

输出：

```ts
{
  task: { key: string; title: string; requirement: string; workflow: string; deliverable: 'code_changes' | 'report' };
  project: { name: string; defaultBranch: string };
  workspace: { path: string; branch: string; baseCommit: string };
  attempt: { kind: AttemptKind; seq: number; retryFeedback?: string };
  askOnUncertainty: boolean;
  plan?: { version: number; summary?: string; nodes: Array<{ key; title; role; status; dependsOn; resultSummary? }> };
  node?: { key; title; role; instructions; acceptance: Acceptance; dependsOn: string[] };
  upstream: Array<{ key; title; summary: string; changedFiles: string[] }>;   // 直接依赖节点
  answeredQuestions: Array<{ question: string; answer: string }>;             // 本任务内已回答/已假设
  userFeedback: string[];                                                     // 重新规划 / 再改改 / 审查意见（21）/ 驳回意见，按时间
  planning?: { guidance?: string; allowedRoles: Array<{ key; name; description }>; requiredSteps: PlanNodeSpec[]; maxNodes: number };  // 仅 plan 类
  databases: Array<{ name: string; type: DbType }>;
}
```

错误：`MCP_ATTEMPT_UNRESOLVED`。

### 6.2 `get_node_output`

输入：`{ node_key: string }`
输出：`{ key, title, summary, changes: Array<{ path; description }>, notes?, assumptions: string[], checkResults: Array<{ kind; passed; output }> }`
错误：`MCP_NODE_NOT_FOUND`（不存在或未 `done`）。

### 6.3 `get_task_diff`

输入：`{ path?: string }`
输出：无 path 时 `{ files: Array<{ path; status: 'added'|'modified'|'deleted'|'renamed'; additions; deletions }> }`；有 path 时 `{ path, diff: string }`（未提交改动 + 已提交改动，相对 `baseCommit`）。
错误：`VALIDATION_FAILED`（path 不在 diff 中）。

### 6.4 `submit_plan`

输入：

```ts
{
  summary: string;                       // 给用户看的计划说明，1..2000
  assumptions?: string[];                // 规划时做出的假设
  nodes: Array<{
    key: string;                         // [a-z0-9_]{1,40}
    title: string;                       // 1..60
    role: string;                        // 角色 key，须在 allowedRoles 内
    instructions: string;                // 1..NODE_INSTRUCTIONS_MAX_CHARS
    depends_on?: string[];
    acceptance?: { command?: string; ai_review?: boolean; manual?: boolean };
  }>;
}
```

行为：校验（08 §5.3 子码，`details.problems[]` 每项带该子码的 `hint`）→ 通过则创建 `draft` 计划版本（`source=ai`），尝试 `succeeded`，任务发 `plan_submitted`。`requiredSteps` 中的节点若未出现由校验报 `MISSING_REQUIRED_STEP`（模型须原样包含，可改 instructions 与 depends_on）；存入计划时必经步骤的 title、角色与验收以流程定义为准。`acceptance` 省略时物化节点用流程的 `defaultAcceptance`。
输出：`{ version: number, accepted: true }`
错误：`PLAN_INVALID`（details.problems）、`MCP_RESULT_ALREADY_SUBMITTED`、`MCP_TOOL_NOT_ALLOWED`。

### 6.5 `submit_result`

输入：

```ts
{
  summary: string;                       // 做了什么，1..4000，Markdown
  changes?: Array<{ path: string; description: string }>;
  assumptions?: string[];                // 本节点做出的假设（未问用户时必须写明）
  notes?: string;                        // 给后续节点/用户的注意事项
  self_check?: { tests_run: boolean; tests_passed?: boolean; details?: string };
}
```

行为：写入节点 `result`；尝试 `succeeded`；节点发 `result_submitted` 进入验收。
输出：`{ accepted: true, next: 'verifying' | 'awaiting_acceptance' | 'done' }`
错误：`MCP_RESULT_ALREADY_SUBMITTED`、`VALIDATION_FAILED`。

### 6.6 `submit_review`

输入：

```ts
{
  verdict: 'pass' | 'fail';
  summary: string;
  issues?: Array<{ severity: 'blocker' | 'major' | 'minor'; path?: string; line?: number; description: string }>;
}
```

行为：作为被评审节点的一条 `ai_review` 检查结果；`fail` 时 issues 作为该节点的 `retryFeedback`。`verdict = fail` 但无 `blocker/major` issue → `VALIDATION_FAILED`（hint：失败必须给出至少一个 blocker 或 major 问题）。
输出：`{ accepted: true }`

### 6.7 `ask_user`

输入：

```ts
{
  question: string;                      // 1..1000
  options?: string[];                    // 2..6 个选项，用户也可自由回答
  blocking: boolean;                     // 不得到答案就无法继续
  default_assumption?: string;           // 不问用户时将采用的假设
}
```

行为：

| 条件 | 结果 |
| --- | --- |
| `askOnUncertainty = false` 且提供 `default_assumption` | 写一条已 resolved 的 question 记录（`assumed`），返回 `{ status: 'assumed', proceed_with: default_assumption }` |
| `askOnUncertainty = false` 且 `blocking = false` 且无 `default_assumption` | `VALIDATION_FAILED`，hint：提供 default_assumption 后继续 |
| 其他（需要问） | 创建 open question；`blocking=true` 返回 `{ status: 'queued', instruction: 'End your turn now. The answer will be sent as the next message.' }`；`blocking=false` 返回 `{ status: 'queued', instruction: 'Continue working; the answer will be sent when available.' }` |

`askOnUncertainty = false` 且 `blocking = true` 且无默认假设：仍然提问（确实无法继续时不强行假设）。

### 6.8 `report_progress`

输入：`{ message: string }`（1..`REPORT_PROGRESS_MAX_CHARS`）
行为：记为当前尝试的 `progress`（只在内存中，尝试结束时清除），推送 `attempt.updated`；节点（或任务规划阶段）的「当前进展」显示其活动尝试的这一行。不写库历史。
输出：`{ ok: true }`

### 6.9 `db_list_connections`

输入：`{}`
输出：`{ connections: Array<{ name: string; type: DbType; database: string }> }`（仅项目关联的；不含主机、用户、密码）。`type` 决定写 SQL 用的方言（v1.2，24 §5），工具说明请模型按它写 SQL

### 6.10 `db_describe`

输入：`{ connection: string; table?: string }`（`connection` 为连接名称，须是任务项目关联的连接）
输出：无 table 时 `{ tables: Array<{ name; comment?; rows?: number }> }`（`rows` 为服务器的估计值）；有 table 时 `{ columns: Array<{ name; type; nullable; key?; default?; comment? }>, indexes: Array<{ name; columns: string[]; unique: boolean }> }`（`type` 为完整列类型如 `varchar(64)`，索引按名称排序）
错误：`DB_CONNECTION_NOT_FOUND`、`DB_CONNECTION_FAILED`、`VALIDATION_FAILED`（表不存在）。

### 6.11 `db_query`

输入：`{ connection: string; sql: string; limit?: number }`（limit ≤ `DB_QUERY_MAX_ROWS`，默认即上限）
行为（只读的四道关，`modules/databases`；下面是 MySQL / GoldenDB 的做法，PostgreSQL / openGauss / SQL Server 的对应做法见 24 §4）：

1. **单条语句**：`databases.sql.ts` 的 `assertReadOnlySql` 去掉字符串、引号标识符与注释后检查：只允许末尾一个分号；`/*! … */` 可执行注释直接拒绝。驱动连接关闭 `multipleStatements`。
2. **首关键字白名单**：`SELECT` / `SHOW` / `DESCRIBE`（`DESC`）/ `EXPLAIN`（允许前导括号）；另拒绝仍会写入或加锁的子句：`INTO`（`INTO OUTFILE` 写服务器文件、`INTO @var`）、`FOR UPDATE` / `FOR SHARE`、`LOCK IN SHARE MODE`。不符合 → `DB_QUERY_REJECTED`。
3. **只读事务**：每次查询独立连接，`START TRANSACTION READ ONLY` 中执行（例如调用会写入的函数被服务器以 1792 拒绝，映射为 `DB_QUERY_REJECTED`），结束后关闭连接。
4. **行数与时间**：流式读取，读满 limit 即停止并关闭连接（`truncated: true`）；`SET SESSION MAX_EXECUTION_TIME = DB_QUERY_TIMEOUT_MS`（服务器中断 SELECT，3024）并以稍长的客户端超时兜住其他语句 → `DB_QUERY_TIMEOUT`。

值按 JSON 返回：日期为字符串，`BIGINT` / `DECIMAL` 为字符串（可能超出 JSON 数字精度；SQL Server 的 `DECIMAL` 例外为数字，24 §5），二进制为 `0x` 开头的十六进制（最多 64 字节）。
输出：`{ columns: string[], rows: unknown[][], truncated: boolean, elapsedMs: number }`
错误：`DB_QUERY_REJECTED`、`DB_QUERY_TIMEOUT`、`DB_QUERY_FAILED`（`details.driverMessage`）、`DB_CONNECTION_FAILED`、`DB_CONNECTION_NOT_FOUND`。

### 6.12 `submit_answer`（v1.1）

只用于 `research` 尝试（知识问答，18 §5–§6）。输入：`{ answer: string; citations: Array<{ type: 'file'; path; start_line; end_line } | { type: 'database'; connection; sql } | { type: 'web'; url; title? }> }`（`answer` 为 Markdown，用 `[n]` 标注引用，n 为 citations 中的位置，从 1 起）。
行为：后端校验每处引用与每个标注（18 §6.2）：通过 → 写入这一轮的回答与引用（文件引用另存被引用的行）并使尝试 `succeeded`；不通过 → `KNOWLEDGE_CITATION_INVALID`，`details.problems[]` 每项带子码、编号与 hint，什么都不写。
输出：`{ accepted: true }`
错误：`KNOWLEDGE_CITATION_INVALID`、`VALIDATION_FAILED`、`MCP_RESULT_ALREADY_SUBMITTED`。

### 6.13 `submit_outline`（v1.2）

只用于 `deck_outline` 尝试（PPT，23 §7.3）。输入：`{ title; understanding: { audience; duration; assumptions: string[] }; slides: Array<{ layout: SlideLayout; title; points: string[] }> }`。
行为：用户指定了页数时页数必须相等（否则 `VALIDATION_FAILED`，`issues[].path = ['slides']`，什么都不写）；通过 → 大纲整体替换这份 PPT 的页面（内容为空），写入理解与标题（用户改过名时不改标题），尝试 `succeeded`。
输出：`{ accepted: true }`
错误：`VALIDATION_FAILED`、`MCP_RESULT_ALREADY_SUBMITTED`。

### 6.14 `submit_slide`（v1.2）

只用于 `deck_slides` 尝试（PPT，23 §7.3）。输入：`{ page: number; content: SlideContent; notes?: string }`（`page` 为页码，从 1 起；`content` 按版式校验字段、条数与字数，`SLIDE_TEXT_LIMITS`）。
行为：`page` 必须是这次工作的目标页之一（否则 `VALIDATION_FAILED`，`path = ['page']`，消息列出目标页码）；通过 → 写入这一页的内容与讲稿（这次工作第一次覆盖已有内容时，旧内容存为上一版）；同一页可以重复提交，以最后一次为准；全部目标页都提交过时尝试 `succeeded`。
输出：`{ accepted: true, remaining: number[] }`（这次工作还没提交的页码）
错误：`VALIDATION_FAILED`、`MCP_RESULT_ALREADY_SUBMITTED`。

## 7. 实现结构

```
core/http/mcp-endpoint.ts   McpServer + StreamableHTTPServerTransport，挂载到 Fastify（/mcp/exec 与 /mcp/assistant 共用）；校验各自的令牌
modules/mcp/
├─ index.ts             组装工具，挂载 /mcp/exec
├─ mcp.registry.ts      工具注册表：definition → 自动生成 tools/list，统一做归属解析（取出 __aw_session）、类型授权、zod 校验、错误映射
└─ tools/
   ├─ get-task-context.tool.ts
   ├─ submit-plan.tool.ts
   └─ ...
```

```ts
export const submitPlanTool = defineMcpTool({
  name: 'submit_plan',
  allowedKinds: [AttemptKind.Plan],
  input: submitPlanInputSchema,
  output: submitPlanOutputSchema,
  hint: { PLAN_INVALID: 'Fix the listed problems and call submit_plan again.' },
  handler: (input, ctx) => ctx.services.plans.submitFromAttempt(ctx.attempt, input),
});
```

工具 handler 只做参数到 service 的转发；业务规则在 service 中，与 REST 共用。

## 8. opencode 1.19.0 实测记录（M0）

| 项 | 结论 |
| --- | --- |
| SDK | 使用 `@opencode-ai/sdk/v2` 的 `createOpencodeClient({ baseUrl })`；方法参数为扁平对象（如 `session.promptAsync({ sessionID, directory, agent, model: { providerID, modelID }, system, parts })`） |
| 启动 | `opencode serve --hostname 127.0.0.1 --port 0 --print-logs --log-level WARN`，从 stdout/stderr 解析 `http://127.0.0.1:<port>` |
| 配置合并 | `OPENCODE_CONFIG_CONTENT` 与用户全局配置合并；`config.get({ directory })` 可见注入的 mcp / agent / plugin；`mcp.status` 为 `connected` |
| 会话 | `session.create({ directory, title, agent, permission })`；同一服务两个目录并发互不干扰 |
| 事件 | `global.event()` 为全局流，每条带 `directory`；`event.subscribe({ directory })` 只含该目录事件。实测事件类型：`session.created/updated/status/idle/diff`、`message.updated`、`message.part.updated/delta`、`permission.asked/replied`、`file.edited`、`server.heartbeat` 等 |
| 权限 | `permission.asked` → `permission.reply({ requestID, directory, reply })` 后会话继续 |
| 规则合并（v1.1） | 发给模型的工具列表按 `merge(agent.permission, session.permission)` 计算被整体 deny 的工具（二进制中 `de.disabled(Object.keys(tools), de.merge(e.agent.permission, e.permission ?? []))`），所以会话级 allow 能重新打开 agent deny 的工具（知识研究员的网络开关，D69） |
| 流式正文（M2） | `message.part.updated` 在文本/思考片段开始（`text` 为空）与结束（带 `time.end`）时各一次，其间是 `message.part.delta`（`field: 'text'`）；工具片段依次 `pending` → `running`（可多次，`metadata.output` 增长）→ `completed` / `error`；`step-finish` 片段带 tokens 与 cost；`server.connected`、`server.heartbeat` 不带 `directory`。样本见 `packages/server/test/fixtures/opencode-1.19.0-events.json` |
| 重试（M2） | 模型请求失败时 `session.status` 为 `{ type: 'retry', message, next }`，会话一直等待到 `next`（如免费额度用尽），不发 `session.error` |
| 内部事件（M2） | `modules/opencode/opencode.events.ts` 只解析用到的事件（消息角色、文本与增量、工具、用量、重试、空闲、错误、权限），加上运行时消失的 `runtime_lost`；其他模块只经 `OpencodeClient.subscribe` 获取 |
| 数据目录 | opencode 会话存于用户自己的 opencode 数据目录（与用户 TUI 共享，登录凭据也在那里），本应用不隔离；会话标题带任务编号便于辨认 |
| 免费模型 | 调用模型的测试（`@opencode` bridge 测试与 `pnpm test:live`）用免费模型，不产生费用，默认值只在 `packages/server/test/helpers/model.ts` 的 `TEST_MODEL` 定义：`opencode-go/deepseek-v4.1-flash`（opencode go 订阅内免费，比 `beam-free` 强），`AW_OC_TEST_MODEL` 可覆盖（D62）。历史：M0 用 `opencode/glm-5.3-flash-free`，2026-10-19 额度用尽后改为 `opencode/beam-free`（D42）；2026-10-20 起 `opencode/*-free` 对开发机网络返回 FreeTierError 403，改用 `opencode-go/beam-free`（D50）；2026-10-21 改为 `opencode-go/deepseek-v4.1-flash`（D62），M6 验收中两者的 live 结果见 16 |
