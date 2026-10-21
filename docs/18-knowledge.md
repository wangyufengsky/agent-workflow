# 18 · 知识问答（v1.1）

> 状态：**v1.1 实现**（任务 K-01…K-10，见 [05](05-dev-plan.md#v11--知识问答)）。需要用户拍板的取舍记在 [02](02-decisions.md) D73–D75（待用户确认），实现按其中的保守方案。

## 1. 定位

用户针对一个项目提问（「退款金额在哪里四舍五入？」），只读的**知识研究员**去查项目资料，给出**带引用的回答**：每个结论后面有引用编号，点开就是原文。

- **资料来源**：代码、文档、数据库（项目关联的连接），提问时可以勾选范围；**网络检索**单独一个开关，默认关闭。
- **全程只读**：研究员不能改文件、不能写 Git、数据库只走只读查询；它在项目主仓库里工作，不建 worktree。
- **研究过程可见**：理解问题 → 检索资料 → 读取原文 → 组织回答，默认折叠成一行。
- **对话记录**：每次提问及其续问组成一个对话，可以回到任意对话继续追问。
- **不是第二套执行机制**：一次提问 = 一次 `research` 类尝试（[12](12-mcp-tools.md)），会话、超时、提醒、中断、会话流、权限请求都复用尝试模块；答案经执行 MCP 的 `submit_answer` 提交，后端校验引用后才算完成。

简单模式就能用：首屏只有输入框、资料范围和示例问题；会话流、用量与模型等细节在专业视图里（专业模式，或页面上的「显示详细信息」）。

## 2. 页面与交互

### 2.1 知识问答 `/knowledge`、`/knowledge/:conversationId`

设计参考 `originals/main/pages/knowledge.html`（REVIEW 第 14 节）。去掉设计稿中的角色证据、外观冻结、版本核对、相关度分数这类状态（D11 的精神：本地同步写，不核对）。

**首屏（没有对话时）**

- 研究员图标 + 标题「关于这个项目，你想了解什么？」+ 一句说明「从代码、文档和数据库中查找依据，每个结论都能回到原文。」
- 项目选择（只有一个项目时直接显示其名称）。
- 输入框：`Enter` 发送、`Shift+Enter` 换行。
- 输入框下方一行资料范围：「将从 代码 · 文档 · 数据库（2）中查找依据 · 网络检索关闭」，点击打开**资料来源**弹层：代码、文档、数据库三个勾选（项目没有关联数据库时「数据库」不可选并说明原因），另有独立的「网络检索」开关，说明「打开后研究员可以访问公开网页，问题内容会发给搜索服务」。三项都不勾时不能发送。
- 三个示例问题（固定文案，点击填入输入框）。

**对话中**

- 顶栏：项目名（锁定图标，悬停说明「对话开始后项目与资料范围不可更换，新建对话后可以切换」）、「对话记录」、「新建对话」。
- 每一轮：用户的问题气泡 → 研究过程卡 → 回答。
- **研究过程卡**：研究中展开，显示四个阶段与当前阶段的细节；有了回答自动收起为一行「研究过程 · 读取 N 份原文 · 用时 Xs」，可再展开。阶段由会话流推导（前端纯函数 `researchSteps(entries)`，不需要模型额外报告）：
  | 阶段 | 依据（会话流中的工具调用） |
  | --- | --- |
  | 理解问题 | 第一个工具调用之前 |
  | 检索资料 | `grep` `glob` `list` `codesearch` `websearch`、bash 的 `rg` `grep` `find` `ls` `git grep` `git log`、`db_list_connections` `db_describe`：显示次数 |
  | 读取原文 | `read`、bash 的 `cat` `head` `tail` `git show`、`webfetch`、`db_query`：逐个列出文件 / 网址 / 查询 |
  | 组织回答 | 调用 `submit_answer` 之后；被拒绝时显示「引用有误，正在修正」 |
  `report_progress` 的最新一句（尝试的「当前进展」）显示在卡片标题旁。
- **回答**：Markdown；引用编号 `[n]` 渲染为可点击的上标。回答在 `submit_answer` 通过校验后一次出现（不流式，D73：引用要先校验）。回答下方列出引用卡（编号、文件路径与行号 / 连接与查询 / 网页标题，点击同样打开原文）。
- **停止**：研究中输入框右侧的按钮变为「停止」，停止后这一轮显示「已停止」，可以「重新提问」（同一问题作为新一轮）。
- **失败**（未提交、超时、会话出错、应用重启中断）：显示原因（按错误码的文案）与「重新提问」。
- **等待你允许**：研究员要运行只读白名单以外的命令时，权限请求进入「需要你处理」（与任务相同，03 §2.5）；这一轮显示「等待你允许一条命令」与「去处理」链接。
- 一个对话同时只有一轮在研究；研究中输入框可以输入但不能发送。

**引用原文面板**

- 点击引用编号或引用卡，右侧推入原文面板（宽 520，主区域收窄，不遮住回答）；回答中对应编号同步高亮。
- 文件：路径、行号区间、原文窗口（引用区间前后各 `KNOWLEDGE_SOURCE_CONTEXT_LINES` 行，带行号），被引用的行高亮并滚动到可见；文件在回答之后被改过时显示「这段原文在回答之后有改动，以下为当前内容」。文件已删除或移出项目时显示错误态。
- 数据库：连接名、SQL；打开时以只读方式重新执行（`KNOWLEDGE_QUERY_ROWS` 行），显示列与行；连接失败按错误码显示。
- 网页：标题与网址，「在浏览器中打开」（`openExternal`）。
- 「上一处 / 下一处」在这一轮的引用之间切换；`Esc` 或关闭按钮收起，焦点回到原编号。

**专业视图**（专业模式，或「显示详细信息」`?details=true`）：每一轮多一个「会话流」折叠区（复用尝试的 `TranscriptView`）、模型与用量（tokens、成本）。

### 2.2 对话记录 `/knowledge/history`

设计参考 `knowledge-history.html`（REVIEW 第 15 节），收敛为：

- 工具条：搜索框（搜问题与回答内容）+ 项目下拉。不设状态分段（研究中的对话很少，行内状态徽标足够）。
- 列表按「今天 / 昨天 / 更早」分组，每行：状态图标、标题（第一次提问）、最后一轮的回答摘要一行（研究中显示「研究中」，失败显示原因）、状态徽标 · 项目 · 轮数 · N 处引用、右侧时间。整行可点，回到该对话继续追问。
- 状态：加载中、空（「还没有对话」+「去提问」）、搜索无结果、加载失败（`ErrorState`）。游标分页「加载更多」（与任务列表相同）。
- 删除对话：行尾菜单，确认对话框（研究中的对话需先停止）。

### 2.3 导航

`知识问答` 进入简单与专业两种模式的侧栏（图标 `book`，位于「项目」之后）；`/knowledge/history` 不单独占菜单，从知识问答页顶栏进入。⌘K 的页面跳转同样包含两个页面。四套主题都只用令牌，走查（J9）加入首屏、回答 + 原文面板、对话记录三个状态。

## 3. 数据模型

迁移 `0009_knowledge`（编号接在助手的 `0008` 之后）。

### knowledge_conversations

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| project_id | TEXT → projects，CASCADE | 对话开始后不可更换 |
| title | TEXT | 第一次提问的首行（`KNOWLEDGE_TITLE_MAX_CHARS`） |
| sources | TEXT(JSON) | `KnowledgeSources`：`{ code, docs, database, web }`，均为布尔；对话开始后固定（D73） |
| created_at / updated_at | INTEGER | `updated_at` 随每一轮的创建与结束更新，列表按它倒序 |

索引：`(project_id)`、`(updated_at)`。

### knowledge_turns

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | |
| conversation_id | TEXT → knowledge_conversations，CASCADE | |
| seq | INTEGER | 对话内序号，从 1 起 |
| question | TEXT | `KNOWLEDGE_QUESTION_MAX_CHARS` |
| attempt_id | TEXT → attempts | 这一轮的 `research` 尝试；后端预先生成尝试 id，尝试行与本行在同一个同步段内写入（§5.3） |
| answer | TEXT NULL | `submit_answer` 通过后写入（Markdown，含 `[n]`） |
| citations | TEXT(JSON) NULL | `Citation[]`（§6），与 answer 同时写入 |
| created_at / answered_at | INTEGER | |

索引：`(conversation_id, seq)` 唯一、`(attempt_id)`。

- **这一轮的状态不单独存**，由尝试状态推导（`knowledgeTurnStatusOf(attemptStatus)`，`shared/enums/knowledge.ts`）：`starting` / `running` → `researching`；`succeeded` → `answered`；`aborted` → `stopped`；`failed` / `interrupted` → `failed`（原因为尝试的 `error`）。尝试状态只经尝试状态机改变，这里只是投影，不另设状态机。
- 会话流就是尝试的会话流：`<数据目录>/runs/knowledge/<attemptId>.jsonl`（10 §3；`task_id` 为空的尝试中 `research` 类放 `runs/knowledge/`，调试尝试仍在 `runs/debug/`）。
- 研究尝试的 `task_id`、`node_id`、`role_id` 为空，`directory` 为项目仓库路径，`model` 为发起时的 `ai.defaultModel`。

**删除**：删除对话 = 删除其轮次，再删除这些轮次的尝试（尝试模块同时删除会话流文件；权限请求条目随尝试级联删除）。研究中的对话不能删除（`KNOWLEDGE_CONVERSATION_BUSY`）。删除项目时（`tasks.deleteProject`）同样先检查项目没有研究中的对话，再在同一事务里删除项目的全部对话与其尝试。

## 4. API（操作清单）

契约在 `shared/operations/knowledge.ts`、DTO 在 `shared/contracts/api/knowledge.ts`；全部 `mode: simple`、`palette: false`、`expose.assistant: true`（应用助手按 D65 照常生成工具，write 需确认，critical 每次确认）。

| 操作 | HTTP | 风险 | 说明 |
| --- | --- | --- | --- |
| `knowledge.list` | `GET /knowledge/conversations?projectId&query&limit&cursor` | read | 对话列表（`KnowledgeConversationSummaryDTO`），按 `updated_at` 倒序，游标分页；`query` 匹配问题与回答 |
| `knowledge.get` | `GET /knowledge/conversations/:id` | read | 对话详情：项目、范围、全部轮次（`KnowledgeTurnDTO`） |
| `knowledge.ask` | `POST /knowledge/conversations` `{ projectId, question, sources }` | write | 新建对话并开始第一轮，返回详情（201） |
| `knowledge.followUp` | `POST /knowledge/conversations/:id/turns` `{ question }` | write | 续问：同一会话的新一轮；上一轮还在研究 → `KNOWLEDGE_CONVERSATION_BUSY` |
| `knowledge.stop` | `POST /knowledge/conversations/:id/stop` | write | 中止研究中的一轮（尝试 `aborted`）；没有研究中的一轮 → `STATE_TRANSITION_INVALID` |
| `knowledge.delete` | `DELETE /knowledge/conversations/:id` | critical | 删除对话（§3） |
| `knowledge.citation` | `GET /knowledge/turns/:turnId/citations/:index` | read | 一处引用的原文（§6.3）；`index` 从 1 起 |

```ts
type KnowledgeSources = { code: boolean; docs: boolean; database: boolean; web: boolean };   // code|docs|database 至少一项

type KnowledgeTurnDTO = {
  id: string; seq: number; question: string;
  status: KnowledgeTurnStatus;                 // researching | answered | stopped | failed
  attempt: AttemptSummaryDTO;                   // 进展、错误、用时；会话流按 attempt.id 读取
  awaitingInput: boolean;                       // 有待处理的权限请求
  answer: string | null;
  citations: CitationDTO[];                     // §6.1，回答前为空
  createdAt: number; answeredAt: number | null;
};

type KnowledgeConversationDTO = {
  id: string; title: string; sources: KnowledgeSources;
  project: { id: string; name: string; repoPath: string; databaseCount: number };   // 研究过程中的文件路径相对 repoPath 显示
  turns: KnowledgeTurnDTO[];
  createdAt: number; updatedAt: number;
};

type KnowledgeConversationSummaryDTO = {
  id: string; title: string; project: { id: string; name: string };
  turnCount: number;
  latest: { status: KnowledgeTurnStatus; answerExcerpt: string | null; citationCount: number; error: ErrorInfo | null };
  updatedAt: number;
};
```

- 发起时 opencode 未就绪 → `OPENCODE_NOT_READY`（503），什么都不写。
- 项目没有关联数据库却勾选了 `database` → `VALIDATION_FAILED`（`details.issues` 指向 `sources.database`）。
- SSE：`knowledge.updated { conversationId }`（新一轮、提交答案、尝试结束、删除时发出），界面据此刷新对话与列表；研究过程的实时片段沿用 `attempt.transcript` 与 `attempt.updated`。

## 5. 研究员 agent 与 MCP 工具

### 5.1 agent `aw-researcher`

注入到 opencode 配置（12 §2）：

```jsonc
"aw-researcher": { "mode": "primary", "description": "agent-workflow researcher", "prompt": "<protocol-research.md>",
  "permission": { "edit": "deny", "question": "deny", "webfetch": "deny", "websearch": "deny", "task": "deny",
                  "external_directory": "deny", "agent-workflow-app_*": "deny" } }
```

- `edit: deny`（opencode 的 write / patch 也归 edit 管）；原生 `question` deny（研究员不提问，见 §5.4）；`task` deny：子 agent 用自己的权限，可能可以写文件（「全程只读」）；助手 MCP 的工具 deny（D25）。
- 会话级规则（`session.create`）：bash 用 `readonlyBashRules()`（不带检查命令：研究员不跑测试）；网络开关打开时追加 `webfetch *` 与 `websearch *` 的 allow。opencode 把 agent 规则与会话规则合并后取最后匹配（被整体 deny 的工具从工具列表中去掉，1.19 实测见 12 §8），所以开关关闭时模型看不到这两个工具。
- 会话 `directory` = 项目仓库路径（主工作区，只读）；`external_directory: deny` 挡住仓库外的读取。
- 尝试模块的 `agent` 参数从 `RoleBaseAgent` 扩为 `SessionAgent`（`planner | executor | reviewer | researcher`，`OPENCODE_AGENT_NAME` 随之扩展）；角色的基础类型仍只有前三个。

### 5.2 尝试类型 `research`

- `AttemptKind.Research`；提交工具 `ATTEMPT_SUBMIT_TOOL.research = submit_answer`；`nudge.md` 照常提醒；超时用 `attempt.timeoutMinutes`。
- 首条消息 `start-research.md`：项目名、问题、本对话的资料范围（勾选项、关联数据库名称、网络开关）、引用规则（§6）；续问 `research-followup.md`：新问题，提醒仍需 `submit_answer`。
- 不计入调度器的并发上限（D74：研究是用户当场发起、等着看的）。

### 5.3 一轮的生命周期

1. `ask` / `followUp`：校验 → 生成尝试 id → `attempts.start({ id, kind: research, agent: researcher, … })`（第一轮）或 `attempts.continueSession(previousAttemptId, { id, … })`（续问：沿用上一轮的 opencode 会话，模型记得之前读过的内容；上一轮没有会话时新开）。两者在第一个 `await` 之前写入尝试行，调用后同步写入轮次行，所以会话里最早的 MCP 调用也能找到这一轮。
2. 模型用原生 read / grep / glob / 只读 bash、`db_*` 工具（数据库在范围内时）、网络工具（打开时）研究，最后调用 `submit_answer`。
3. `submit_answer` 校验引用（§6.2）：不通过 → `KNOWLEDGE_CITATION_INVALID` + 每处问题的 hint，模型修正后重提；通过 → 在一个事务里写入 answer / citations 并 `attempts.markSubmitted`，发 `knowledge.updated`。
4. 尝试结束（任何终态）时知识模块经 `attempts.onSignal('ended')` 更新对话的 `updated_at` 并发 `knowledge.updated`。

### 5.4 MCP 工具

| 工具 | `research` 中的行为 |
| --- | --- |
| `submit_answer` | **新增，仅 research**：提交回答与引用（§6） |
| `report_progress` | 允许；最新一句显示在研究过程卡上 |
| `db_list_connections` / `db_describe` / `db_query` | 允许；连接来自对话的项目。范围不含数据库时 `db_list_connections` 返回空列表，其他两个返回 `DB_CONNECTION_NOT_FOUND`（与调试尝试相同） |
| `get_task_context` `get_node_output` `get_task_diff` `submit_*` `ask_user` | 不允许（`MCP_TOOL_NOT_ALLOWED`）。研究员不向用户提问：问题有歧义时在回答里写明理解与假设 |

## 6. 引用

### 6.1 数据结构

`submit_answer` 输入（`shared/contracts/mcp/submit-answer.ts`）：

```ts
{
  answer: string;                 // Markdown，1…KNOWLEDGE_ANSWER_MAX_CHARS；用 [1] [2] 标注引用，编号 = citations 中的位置（从 1 起）
  citations: Array<               // 0…KNOWLEDGE_MAX_CITATIONS
    | { type: 'file'; path: string; start_line: number; end_line: number }   // 代码与文档：相对仓库根的路径 + 行号区间（含两端，从 1 起）
    | { type: 'database'; connection: string; sql: string }                 // 数据库：连接名称 + 只读查询
    | { type: 'web'; url: string; title?: string }                          // 网页（仅网络开关打开时）
  >;
}
// 成功返回 { accepted: true }
```

存储与 DTO（`CitationDTO`）：`file` 另存 `excerpt`（校验时读出的被引用行，截断到 `KNOWLEDGE_EXCERPT_MAX_CHARS`）与 `source: 'code' | 'docs'`（`classifySource(path)`：扩展名为 `.md .mdx .markdown .txt .rst .adoc`，或任一级目录名为 `docs` / `doc` 时为文档，其余为代码；`KNOWLEDGE_DOC_EXTENSIONS`、`KNOWLEDGE_DOC_DIRS`，不分大小写）；`database` 原样；`web` 原样。

引用标注 `[n]` 的识别（`citationMarkers(answer)`，`shared/knowledge/citations.ts`，后端校验与前端渲染共用）：`[` 数字 `]` 且后面不是 `(`（不是 Markdown 链接），跳过代码块与行内代码。

### 6.2 校验（`KNOWLEDGE_CITATION_INVALID`，`details.problems[]`）

一次返回全部问题，每项 `{ code, citation?, message, hint, details? }`（`citation` 为从 1 起的编号）；子码 `CitationProblemCode` 与给模型的 hint `CITATION_PROBLEM_HINT` 在 `shared/errors/citation-problems.ts`：

| 子码 | 含义 | 给模型的 hint |
| --- | --- | --- |
| `OUTSIDE_PROJECT` | 路径是绝对路径、含 `..` 越出仓库、经符号链接指向仓库外，或位于 `.git/` 内 | 用相对仓库根的路径，只引用仓库内的文件 |
| `FILE_NOT_FOUND` | 文件不存在或不是普通文件 | 用 glob / ls 确认路径后再引用 |
| `LINE_OUT_OF_RANGE` | `start_line > end_line`，或 `end_line` 超过文件行数；`details.lineCount` | 按 read 工具显示的行号引用，不超过文件行数 |
| `RANGE_TOO_LONG` | 区间超过 `KNOWLEDGE_CITATION_MAX_LINES` 行 | 只引用支撑结论的那几行 |
| `SOURCE_NOT_SELECTED` | 引用的来源类别（代码 / 文档 / 数据库 / 网页）不在这次提问的范围内 | 只引用范围内的资料 |
| `UNKNOWN_CONNECTION` | 连接名称不是项目关联的连接 | 用 `db_list_connections` 返回的名称 |
| `QUERY_NOT_READONLY` | SQL 不是单条只读语句（与 `db_query` 同一套检查，D58） | 只引用 SELECT / SHOW / DESCRIBE / EXPLAIN |
| `UNKNOWN_MARKER` | 回答中的 `[n]` 没有对应的引用 | 编号从 1 起，对应 citations 的位置 |
| `UNUSED_CITATION` | 某条引用在回答中没有被标注 | 在回答中标注它，或从 citations 中去掉 |

- 路径检查：`realpath(join(repo, path))` 必须位于 `realpath(repo)` 之内（06 §11），不在 `.git` 下；在后端读取，不信任模型给出的内容。
- 数据库引用不在提交时执行查询（打开原文时才执行，§6.3），只检查连接与只读。
- 无效引用从不静默丢弃：整次提交被拒绝，模型按 hint 修正后重提；同一尝试已成功提交后再调用 → `MCP_RESULT_ALREADY_SUBMITTED`。
- 没有引用的回答是允许的（例如「项目中没有找到相关实现」）。

### 6.3 读取原文 `knowledge.citation`

```ts
type CitationSourceDTO =
  | { type: 'file'; path: string; startLine: number; endLine: number;
      firstLine: number; lines: string[]; lineCount: number; changed: boolean }   // 窗口：区间前后各 KNOWLEDGE_SOURCE_CONTEXT_LINES 行
  | { type: 'database'; connection: string; sql: string; result: DbQueryOutput }   // 只读重新执行，KNOWLEDGE_QUERY_ROWS 行
  | { type: 'web'; url: string; title: string | null };
```

- 只能读取**被引用过**的原文：路径来自已存的引用，读取时再做一次 §6.2 的路径检查（文件可能已被替换为指向仓库外的符号链接）；文件已不存在 → `KNOWLEDGE_SOURCE_UNAVAILABLE`（404）。`changed` = 当前区间内容与存下的 `excerpt` 不同。
- 编号超出这一轮的引用数，或轮次不存在 → `KNOWLEDGE_CITATION_NOT_FOUND`（404）。
- 数据库连接已被取消关联或删除 → `DB_CONNECTION_NOT_FOUND`；查询失败按数据库错误码返回。

## 7. 枚举、常量、错误码（08）

- 枚举（`shared/enums/knowledge.ts`）：`KnowledgeTurnStatus`（`researching` `answered` `stopped` `failed`，`STATUS_TONE`：accent / ok / idle / fail）、`CitationType`（`file` `database` `web`）、`KnowledgeSourceKind`（`code` `docs` `database` `web`）、`CitationProblemCode`；`AttemptKind` 加 `research`；`SessionAgent`；`McpToolName.SubmitAnswer`；`ServerEventType.KnowledgeUpdated`。
- 常量：`OPENCODE_AGENT_NAME.researcher = 'aw-researcher'`、`KNOWLEDGE_DOC_DIRS`、`KNOWLEDGE_DOC_EXTENSIONS`；限制值 `KNOWLEDGE_QUESTION_MAX_CHARS`（4000）、`KNOWLEDGE_TITLE_MAX_CHARS`（80）、`KNOWLEDGE_ANSWER_MAX_CHARS`（20000）、`KNOWLEDGE_MAX_CITATIONS`（20）、`KNOWLEDGE_CITATION_MAX_LINES`（200）、`KNOWLEDGE_EXCERPT_MAX_CHARS`（4000）、`KNOWLEDGE_SOURCE_CONTEXT_LINES`（40）、`KNOWLEDGE_QUERY_ROWS`（50）、`KNOWLEDGE_ANSWER_EXCERPT_CHARS`（160）；列表分页沿用 `LIST_PAGE_DEFAULT` / `LIST_PAGE_MAX`。详见 08。
- 错误码：`KNOWLEDGE_CONVERSATION_NOT_FOUND`（404）、`KNOWLEDGE_CONVERSATION_BUSY`（409，研究中又发起续问 / 删除对话 / 删除项目）、`KNOWLEDGE_CITATION_INVALID`（MCP，`details.problems[]`）、`KNOWLEDGE_CITATION_NOT_FOUND`（404）、`KNOWLEDGE_SOURCE_UNAVAILABLE`（404）。
- 没有新设置项。

## 8. 实现结构

```
packages/shared/src/
├─ enums/knowledge.ts                  §7 枚举、knowledgeTurnStatusOf
├─ knowledge/citations.ts              citationMarkers、classifySource（前后端共用）
├─ errors/citation-problems.ts         子码与 hint
├─ contracts/api/knowledge.ts          DTO
├─ contracts/mcp/submit-answer.ts
└─ operations/knowledge.ts
packages/server/src/modules/knowledge/
├─ knowledge.table.ts / .repo.ts       两张表
├─ knowledge.service.ts                提问、续问、停止、删除、列表、详情；尝试结束的反应
├─ knowledge.citations.ts              引用校验（路径、行号、来源、连接、只读、标注）与原文读取
├─ knowledge.operations.ts / index.ts
packages/server/src/modules/mcp/tools/submit-answer.tool.ts
packages/builtin/prompts/protocol-research.md、start-research.md、research-followup.md
apps/web/src/features/knowledge/       页面、研究过程卡、回答与引用、原文面板、资料来源弹层、对话记录
```

依赖方向：`knowledge` → `attempts`、`projects`、`databases`、`inbox`；`tasks`（删除项目）与 `mcp` → `knowledge`。

## 9. 测试

| 层 | 覆盖 |
| --- | --- |
| 单元 | `citationMarkers`（链接、代码块、行内代码不算）、`classifySource`、`knowledgeTurnStatusOf`、`researchSteps`（前端阶段推导）、配置快照（`aw-researcher` 权限）、会话规则（网络开关） |
| 集成 | `knowledge.int.test.ts`（FakeOpencode）：提问 → 会话的目录 / agent / 规则正确 → `submit_answer` 通过后轮次 `answered`、引用与 excerpt 正确；引用校验每个子码（不存在的文件、越界行号、`..` 与符号链接越界、`.git`、范围外来源、未知标注、未用引用、未知连接）且返回 hint，修正后重提成功；只读：研究会话的规则无 edit、bash 写命令 ask、`task` deny、网络默认 deny；续问沿用同一 opencode 会话且上一轮研究中时 `KNOWLEDGE_CONVERSATION_BUSY`；停止 → `stopped`；未提交 → 提醒 → `failed`；读取原文（窗口、`changed`、文件删除后 404、编号越界 404）；删除对话清理尝试与会话流；删除项目时研究中拒绝、结束后级联；`research` 尝试不能调用 `submit_result` / `ask_user`；数据库引用（Docker MySQL）：原文重新执行只读查询 |
| `@opencode` | 注入后 `aw-researcher` 在 opencode 配置中可见 |
| E2E | J12（FakeOpencode）：首屏 → 提问 → 研究过程（检索、读取）→ 带引用的回答 → 点击引用看原文（高亮、下一处）→ 续问 → 对话记录中出现并可回到对话；J9 走查加入知识问答三个状态 |
| live | `live/knowledge.live.test.ts`：对 `ts-stats` 提一个有确定答案的问题，断言回答带有效引用且引用指向正确的文件，报告写到 `live/reports/knowledge-*.json` |
