# 39 · Word 与 Excel 文件

> 状态：**设计已确认**（2026-10-26，D193–D201 均按推荐方案，§17），实施中：OF-01（解析与附件接入）、OF-02（Excel 概览与表格工具）、OF-03（附件条与预览）、OF-04（助手生成 Word / Excel 与文件卡片）已完成。
>
> OF-01 的实测：Electron 44 的 utilityProcess 能从 `app.asar` 里加载解析 worker（`office-worker.js`），其 Node 24.22（ICU 78.2）能按 GB18030 解码。样本只有 LibreOffice、macOS 文本编辑（textutil）保存的文件和 msoffcrypto-tool 加密的文件：用脚本驱动 Microsoft Word 另存失败，WPS 只能手动操作，二者的样本待补。macOS 文本编辑保存的 Word 没有标题样式，表格也变成了段落，只能按段落读出。实施任务见 [05 的 OF 系列](05-dev-plan.md#后续--word-与-excel-文件of)。枚举、常量、表、接口、工具在实施时登记到 08–12，本文先写在 §11–§12。

用户原话：「新增处理 word、excel 的能力，现在的 AI 助手只能上传文本，不能上传这些格式，也缺少处理这些文件的工具」。

## 1. 现状与要解决的问题

| 现状 | 出处 |
| --- | --- |
| 附件只收严格 UTF-8 文本，`.docx` / `.xlsx` 上传即被拒（`ATTACHMENT_INVALID_TYPE`，`reason: not_text`）；30 把「PDF / DOCX 正文提取」放在 U2 另行确认 | 30 §1、§3.1 |
| AI 的原生 `read` 读 `.docx` / `.xlsx` 只能看到 zip 字节，仓库里的 Office 文件对任务和知识问答都是「看不见」的 | 12 §1 |
| 助手能在自己的对话目录 `files/<conversationId>/` 写文件，但只会写文本；生成的文件在消息流里是一张只有「在 Finder 中显示」的卡片 | 15 §2、§3 |
| 已有的 Office 产出只有 PPT：渲染进程用 pptxgenjs 生成 `.pptx`，经 preload `saveFile` 另存 | 23 §6.2 |

典型场景：

| 场景 | 现在 | 本设计之后 |
| --- | --- | --- |
| 把 Word 需求文档拖进主页，直接开始任务 | 只能复制粘贴正文 | 正文（含标题层级、列表、表格）进提示词，规划、执行、评审都能看到 |
| 上传销售明细 Excel，问助手「各区域合计多少、哪个月最差」 | 做不到 | 助手看到工作簿概览，用 `query_sheet` 做筛选、分组、汇总后回答 |
| 「把上面的结论整理成一份 Word 周报」 | 只能得到 Markdown | 助手用 `create_docx` 生成 `.docx`，卡片上可预览、另存为、用默认应用打开 |
| 「把这张表的 C 列改成含税价，加一列合计，另存一份」 | 做不到 | 助手用 `edit_xlsx` 在原件副本上修改，原有样式、列宽、合并单元格保留 |
| 仓库里有 `docs/接口清单.xlsx` 或配置表，任务要据此写代码 | AI 读不了 | 执行者用 `read_office_file` 读出文字与表格 |

约束：工作环境的模型只支持文本；要能在内网离线部署（05 的 IN 系列）；平台为 macOS arm64 与 Linux x64 / arm64，机器上不一定装了 Office、WPS 或 LibreOffice；简单模式不再增加导航、主页分段和设置项（38 C6）。

## 2. 结论：加模块、加功能还是加流程（D193）

**推荐：加一个没有页面的后端能力模块 `office`，再在三处现有功能里加功能（附件、助手、任务的 MCP 工具）；不加流程，不加新页面。**

| 方案 | 做法 | 判断 |
| --- | --- | --- |
| A. 能力模块 + 现有功能扩展（推荐） | `modules/office` 只做「Office ↔ 文字 / 结构」的转换，无表、无状态、无页面；附件接受 Office 文件，助手与任务各加几个工具，文件卡片加预览与另存为 | 用户要的是「能带进来、能读懂、能产出文件」，这三件事的生命周期就是现有的附件与对话，不需要新的对象和页面 |
| B. 像 PPT 一样的新功能模块（「文档工作台」页面、作品列表、逐段编辑） | 新路由、新表、新的 AI 尝试类型 | PPT 有自己的生命周期（大纲确认 → 逐页制作 → 逐页改 → 导出），所以值得一个模块；Word / Excel 的需求是一次问答或一次生成，做工作台会与助手重复，也违背 38 的收敛 |
| C. 新流程（内置流程或组合模板） | 例如「Excel 数据整理」流程 | 流程编排的是多步开发任务（13、34），Office 文件是输入和输出的**格式**，所有流程都应受益而不是只有一个流程能用；整理表格、出报告一句话在助手里就能完成，不需要 worktree 与评审 |

为什么不归进 attachments 模块本身：转换逻辑还要被助手的生成工具、执行 MCP 读仓库文件、文件卡片预览复用，且依赖较重（§9），单独成模块让附件模块保持「保存、校验、引用、清理」的职责（30 §5）。

## 3. 整体结构

```
带进来                         读懂                                  产出
──────                        ────                                  ────
上传 / 项目文件                提示词附件节（Word 正文 / Excel 概览）    create_docx / create_xlsx
   │                            read_attachment（不变）                edit_xlsx / revise_docx
   ▼                            read_sheet / query_sheet（新）            │
attachments.save ──► office.parse（worker 线程）                         ▼
   │                    │                                     office.render（同一 worker）
   ▼                    ▼                                                │
attachments/<id>/original + text.md + workbook.json        files/<conversationId>/报告.docx
                                                                         │
仓库里的 Office 文件 ──► read_office_file（新，执行 MCP）           文件卡片：预览 / 另存为 / 打开
```

模块边界（03 §4 的分层不变）：

- `modules/office/`：纯转换。`detect(bytes)`、`parse(path) → { format, text, workbook?, meta }`、`renderDocx(spec)`、`renderXlsx(spec)`、`editXlsx(source, ops)`、`querySheet(workbook, query)`；重活在 `office.worker.ts` 中执行（§5.1）。不 import 任何业务模块。
- `attachments`：上传时调用 `office.parse` 并保存派生文件；对外仍是「记录存在就是可用的」。
- `assistant`：生成与修改工具写入对话目录，复用现有的 `attachment` 消息流条目。
- `mcp`（执行 MCP）：`read_sheet` / `query_sheet` / `read_office_file`，范围按尝试所属任务限定（与 `read_attachment` 一致）。

## 4. 支持的格式（D194）

| 格式 | 首版 | 说明 |
| --- | --- | --- |
| `.docx`、`.docm` | 支持 | `.docm` 只读正文，宏不读取、不执行 |
| `.xlsx`、`.xlsm` | 支持 | 同上 |
| `.csv`、`.tsv` | 照旧按文本 | 另加：文件名以 `.csv` / `.tsv` / `.txt` 结尾且不是合法 UTF-8 时，按 GB18030 解码（中文 Windows 上 Excel 另存的 CSV 默认是 GBK）；解出的文字仍须不含 NUL |
| `.doc`、`.xls`（97–2003 二进制） | 拒绝，提示「请在 Word / Excel / WPS 中另存为 .docx / .xlsx」 | 备选：引入 SheetJS 与 word-extractor 支持（§9） |
| 加密（设置了打开密码）的 Office 文件 | 拒绝，提示「文件有密码保护，请去掉密码后再上传」 | 不接收密码 |
| `.pptx`、`.pdf`、`.wps` / `.et` | 不在本期 | `.pptx` 与 PDF 留给 30 的 U2 |

格式**看内容不看扩展名**（与 30 §3.1 一致）：

- zip 签名 `PK\x03\x04`，且 `[Content_Types].xml` 声明的主部件是 WordprocessingML 文档（`…wordprocessingml.document.main+xml` 或 `…macroEnabled.main+xml`）→ `docx`；是 SpreadsheetML 工作簿 → `xlsx`；其他 zip → `unsupported`。
- OLE 复合文档签名 `D0 CF 11 E0`：含 `EncryptionInfo` 流 → `encrypted`（加密的 OOXML 就是这样包装的）；否则 → `legacy_office`。
- 其余走现有文本校验。

## 5. 上传与解析（D195）

仍是同一个 `POST /attachments`（二进制请求体），流程在 30 §3.1 上加一步：

1. 写临时文件，识别格式（§4）。文本照旧校验。
2. Office 文件交给 worker 线程解析，得到模型看的文字 `text.md`、Excel 的结构 `workbook.json` 与摘要 `meta`。
3. 全部成功后原子改名到 `attachments/<id>/`，插入记录；任一步失败直接返回错误，不留记录。

所以**没有「解析中」状态，记录存在就是可用的**，30 的生命周期、引用、清理全部不变。前端上传卡片的转圈时间变长（解析在同一个请求里），文案从「正在上传…」改为「正在读取…」。

为什么在上传时解析，而不是每次用时再解析：失败（加密、损坏、过大）当场显示在卡片上，用户还没发送；之后提示词、`read_attachment`、预览看到的都是同一份文字，与 30「之后的步骤看到的是同一份内容」一致；不必在每次工具调用时重复解压与解析。

| 文件 | 何时有 | 内容 |
| --- | --- | --- |
| `original` | 所有附件 | 原件，不变 |
| `text.md` | Office 附件 | 模型读的文字（§5.2、§5.3）；`read_attachment` 与提示词摘录都读它 |
| `workbook.json` | Excel 附件 | 每个工作表的单元格值、公式、合并区域、隐藏标记；`read_sheet`、`query_sheet`、预览读它 |

表 `attachments` 加两列（迁移，旧记录为 `text`）：`format`（`AttachmentFormat`）与 `meta`（JSON：Word 为字数、标题数、表格数、图片数；Excel 为各工作表名、已用区域、行列数，以及公式、图表、图片、透视表的数量）。DTO 带上这两项，卡片副标题显示「Word · 8,532 字」「Excel · 3 个工作表 · 1,204 行」。

### 5.1 worker 线程

解析一个 20 MiB 的 xlsx 要几秒、几百 MB 内存。后端是单线程的 Fastify，在主线程解析会卡住 SSE、MCP 和其他请求，所以用 Node 内置的 `worker_threads`：

- 每次解析或生成起一个 worker，`resourceLimits.maxOldGenerationSizeMb` 限内存；超过时限 `terminate()`，返回 `ATTACHMENT_PARSE_FAILED`（`reason: timeout` 或 `out_of_memory`）。worker 用完即退，不常驻。
- 防 zip 炸弹：中央目录里的大小是文件自己声明的，可以作假，所以 worker 在交给解析库之前先把每个部件实际解压一遍、只计数不保留，合计超过上限即拒绝（`ATTACHMENT_TOO_LARGE`，`reason: unzipped`）；识别格式时只解压很小的 `[Content_Types].xml`（超过 1 MiB 视为损坏）。
- `office.worker.ts` 作为 electron-vite 后端构建的另一个入口；OF-01 的第一步是在打包后的 utilityProcess 中实测 worker 可用（`pnpm e2e:smoke` 上传一个 xlsx）。

### 5.2 Word → Markdown

- 用 mammoth 把正文转成 HTML（标题按样式映射为 `h1`–`h6`，列表、表格、粗体斜体、超链接、脚注尾注），再用自写的小转换器（只认这十几种标签）转成 Markdown；表格转 GFM 表格，合并单元格展开为重复值。
- 图片不提取（模型不支持图片），原位置写 `[图片 3：<替代文字，没有时写「无说明」>]`，让模型知道那里有图。
- 修订按「接受修订后」的文字；批注、页眉页脚、文本框不保证提取。界面与提示词都写明「图片、批注、页眉页脚未包含」。
- mammoth 锁定 1.11.0 及以后（之前的版本默认会读取文档中外部链接指向的本机文件，CVE-2025-11849）。

### 5.3 Excel → 工作簿结构与文字

- 用 exceljs 读每个工作表的已用区域；单元格取**值**：数字原值、日期为 ISO 8601、布尔、错误值（`#DIV/0!`）、富文本取纯文字；公式另存公式文本与文件里缓存的结果。
- 不重算公式（不带计算引擎）。有的程序生成的文件不存缓存结果，此时值为空，并在 `workbook.json` 里标记，`read_sheet` 返回 `formula_without_value` 提示。
- 隐藏的工作表、行、列照常读出并标记；图表、图片、透视表、条件格式、数据验证不提取，只在 `meta` 里计数。
- `text.md`：每个工作表一节 `## 工作表「销售明细」（A1:F1204，1,204 行 × 6 列）`，下接 Markdown 表格，**首列为行号、表头为列字母**，模型可以用 `C17`、`A2:F2` 这样的坐标指称和修改。 跨越超过 `SHEET_GRID_MAX_COLUMNS`（50）列的工作表改为逐行列出有内容的单元格（`- 1：A1 = 日期；XFD1 = 备注`），文字随单元格数增长，而不是行数乘列数（只在 XFD1 有一个值也会让每行补满 16,384 列）。

## 6. 交给模型的形式（D196）

工作环境的模型只读文字，所以模型看到的一律是文字：Word 是正文 Markdown，Excel 是概览 + 按需读取的工具。现有 `opencode.client.ts` 只发一个 text part 的方式不用改。

### 6.1 提示词

- **Word**：与文本附件相同（30 §3.2），`text.md` 进附件块，所有附件合计超过 20,000 字符时平分额度并给 `cursor`，模型用 `read_attachment` 读完。
- **Excel**：不放整张表（按字符截断会切断行，且大表放不下），放**工作簿概览**：每个工作表的名字、区域、行列数、前 10 行与最后 2 行（含表头）、公式与图表数量；超过 20 个工作表时只列名字。概览后一句写明用 `read_sheet` 读更多行、用 `query_sheet` 做筛选与汇总。

```xml
<attachment attachment_id="att_9" name="销售明细.xlsx" source="upload" format="xlsx" sheets="2">
## 工作表「明细」（A1:F1204，1,204 行 × 6 列；前 10 行与最后 2 行）
| 行 | A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 日期 | 区域 | 产品 | 数量 | 单价 | 金额 |
| 2 | 2026-09-01 | 华东 | A100 | 12 | 35 | 420 |
…
## 工作表「汇总」（A1:C5，含 4 个公式）
…
</attachment>
```

### 6.2 读取工具

| 工具 | 输入 → 输出 | 说明 |
| --- | --- | --- |
| `read_attachment` | 不变 | Office 附件读的是 `text.md` |
| `read_sheet` | `{ attachment_id, sheet, range?, include_formulas? = false }` → `{ attachment_id, sheet, range, columns, rows: [{ row, hidden, values, formulas? }], next_range }` | 按**行**分页，不切断行；每页的 JSON 不超过 `ATTACHMENT_READ_MAX_CHARS`（至少一行）；`range` 省略时读整个已用区域，`values` 与 `columns` 的列字母对齐 |
| `query_sheet` | `{ attachment_id, sheet, header_row? = 1, columns?, where?, group_by?, aggregates?, order_by?, limit? = 100 }` → `{ attachment_id, sheet, columns, rows, total_rows }` | 结构化查询，在 worker 里用 JS 执行：`where` 为 `[{ column, op: eq/ne/gt/gte/lt/lte/contains/in/empty/not_empty, value }]`（全部满足），`aggregates` 为 `count/sum/avg/min/max`（结果列名如 `sum(金额)`，`order_by` 用结果列名）；`limit` 最多 `SHEET_QUERY_MAX_ROWS`（500）。列用表头文字或列字母指定；sum / avg 只算数字（存成文字的数字也算），count 不带列时数行 |

OF-02 只读附件（`attachment_id`）；助手读回自己在对话目录里生成或修改的文件（`{ file }`）随 OF-04 加上。工具名不对的工作表、列、排序列与对 Word 附件调用都是 `VALIDATION_FAILED`，消息列出可用的名字。

提示词里的概览在保存附件时由 worker 一并写成 `overview.md`（与 `text.md`、`workbook.json` 同目录），渲染提示词时同步读它、不解析单元格；所有附件超过 20,000 字符时 Excel 概览在行尾截断，不给 `cursor`（剩下的用表格工具读）。

范围与 `read_attachment` 相同：执行 MCP 只能读当前尝试所属任务的附件（plan / execute / review / breakdown），助手只能读当前对话的附件和对话目录；范围外一律 `ATTACHMENT_NOT_FOUND`。

为什么用结构化查询而不是让模型写 SQL：参数用 zod 严格校验，没有注入与越权面（不需要像 `db_query` 那样设四道关），免费模型也写得对；覆盖「筛选、分组、汇总、排序、取前 N」这类最常见的问题。复杂的分析（多表关联、透视）先不做，见 D196 备选。

## 7. 生成与修改（D197、D198）

### 7.1 工具做在应用的 MCP 里

| 方案 | 判断 |
| --- | --- |
| **应用 MCP 工具（推荐）** | 已有的工具注册、调用归属、zod 校验、结构化错误、范围限定都能直接用（12 §3、§7）；转换在后端 worker 里做，依赖随后端打包 |
| opencode 插件工具 | 插件跑在 opencode 进程里，拿不到附件记录与对话范围，依赖要另打包进插件；插件按目录实例加载，须无状态（12 §3） |
| 让模型写脚本（python-docx、openpyxl、Node 脚本） | 要求机器上有 Python / 库，内网离线装不上；助手的 shell 每条都要用户批准（15 §2）；生成结果无法校验 |

### 7.2 助手的工具

| 工具 | 输入 | 输出与行为 |
| --- | --- | --- |
| `create_docx` | `{ file, title?, blocks }`（`style_from` 随 OF-05 的 `revise_docx` 一起做）；`blocks` 为 `heading { level 1–4, text }` / `paragraph { text }` / `list { ordered, items }` / `table { header, rows }` / `page_break`；文字中可用 `**粗体**`、`*斜体*`、`[链接](url)` | 写一个新的 `.docx`；`style_from` 为一个 Word `source` 时沿用它的样式表（标题、正文字体与字号） |
| `create_xlsx` | `{ file, sheets: [{ name, columns: [{ header, type?: text/number/date/percent/currency, width? }], rows?, rows_from?, freeze_header? = true }] }`；单元格为字符串、数字、布尔、`null`、`{ date }` 或 `{ formula }` | 写一个新的 `.xlsx`；`rows_from` 为一次 `query_sheet` 的参数，数据由后端直接从源表取出写入，大表不必经过模型的输出 |
| `edit_xlsx` | `{ source, file, operations }`；操作为 `set_cells { sheet, start, values }`、`insert_rows`、`delete_rows`、`insert_columns`、`delete_columns`、`add_sheet`、`rename_sheet`、`delete_sheet` | 在原件的副本上修改后另存为 `file`；单元格样式、列宽、合并、公式、其他工作表保留 |
| `revise_docx` | `{ source, file, blocks }` | 按 `blocks` 重写成新文件，沿用原件的样式表；见下方保真说明 |

- `file` 是对话目录内的相对路径，扩展名必须与工具一致；越界或扩展名不对为 `VALIDATION_FAILED`。同名文件已存在时加序号（`周报 (2).docx`），返回实际路径，不覆盖。
- 写入后与原生 `write` 一样在消息流追加 `attachment` 条目（15 §2）。风险为 `read`：只写本对话目录、不改用户的任何文件，与原生写文件一样不出确认卡。
- 校验失败统一为 `VALIDATION_FAILED`，`details.issues` 指出字段与改法（与 PPT 的 `submit_slide` 相同，23 开头的实现说明）。
- **原件永远不变**：附件是不可变的（30 §3.1），修改一律另存新文件。
- **保真说明**：`edit_xlsx` 经 exceljs 往返，图表、图片、透视表、切片器可能丢失；`revise_docx` 只保留样式表，页眉页脚、页面设置、图片、批注不保留。工具按 `meta` 对比原件与新文件，把丢失的内容放进返回的 `warnings`，模型须告诉用户，卡片上也显示一行提示。Word 的原位修改（保留全部排版只改几段字）不在首版，见 D198 备选。
- **公式安全**：只有显式的 `{ formula }` 写成公式，普通字符串即使以 `=` 开头也写成文本；拒绝引用其他工作簿和会联网的函数（`WEBSERVICE`、`FILTERXML`、`HYPERLINK` 等），因为附件里的文字可能诱导模型写出打开文件时把数据发出去的公式。

### 7.3 任务里（D199）

- **首版只读**：规划、执行、评审、需求拆解能读任务附件（§6.2）；仓库里的 Office 文件用执行 MCP 新工具 `read_office_file { path, sheet?, range? }` 读，`path` 是会话目录（worktree 或项目仓库）内的相对路径，越界、符号链接指向根外按 `core/repo-files.ts` 拒绝；知识研究员同样可用。「项目文件…」快照也接受 `.docx` / `.xlsx`（同一解析）。
- **首版不做**：任务在 worktree 里生成或修改 Office 文件。它会进节点提交，二进制 diff 在评审和 Git 工作台里无法审阅；需要表格产出时让执行者写 CSV。

## 8. 界面

### 8.1 附件卡片与预览

- 「+」菜单的「上传文件…」与拖放接受 `.docx` `.xlsx`（文件选择器的 `accept` 加上它们；后端仍看内容判断）。
- 卡片：格式图标（通用的文档 / 表格图标，不用产品商标）、名称、副标题（§5 的摘要）。失败卡片的原因：

| 原因 | 文案 |
| --- | --- |
| `legacy_office` | 不支持旧版 .doc / .xls，请另存为 .docx / .xlsx 后再上传 |
| `encrypted` | 文件有密码保护，请去掉密码后再上传 |
| `unsupported` | 暂不支持这种文件，目前支持文本、Word（.docx）和 Excel（.xlsx） |
| 过大 / 单元格过多 | 文件太大（上限 20 MB / 50 万个单元格），可以删掉不需要的工作表或另存为 CSV |
| 解析失败 | 文件已损坏或无法读取 |

- 预览（复用 `attachment-preview.tsx` 的对话框）：Word 显示提取出的正文（应用的 `Markdown` 组件）；Excel 为工作表页签 + 表格（行号与列字母、表头与行号固定、隐藏的行标出、最多显示 `OFFICE_PREVIEW_ROWS` 1,000 行，超出时说明「完整内容 AI 可以通过工具读取」；超过 `SHEET_GRID_MAX_COLUMNS` 列的工作表按单元格列出）。顶部一行说明「这是 AI 读到的内容；图片、图表、批注没有包含」。Excel 预览按工作表经 `attachments.previewSheet`（`GET /attachments/:id/sheet?sheet=`）取前 1,000 行，在 worker 里读 `workbook.json`。
- 前端在上传前按名字预检大小：`.docx` / `.docm` / `.xlsx` / `.xlsm` 用 20 MiB，其余 5 MiB（最终仍由后端按内容判断）；卡片在上传 Office 文件时显示「正在读取…」，失败卡片按 `details.reason` 显示上表的原因（`ErrorState` 的 `message`）。

### 8.2 助手生成的文件

助手写的文件在消息流里是一张文件卡片（`features/assistant/file-card.tsx`，OF-04 已实现）：

- 标题行为「助手生成的文件 · Word / Excel · 大小」与路径；摘要（字数、工作表与行数）在预览的标题下，不为卡片逐个解析文件。OF-05 的 `warnings` 再加一行弱化提示。
- 按钮：「预览」（只对 `.docx` / `.xlsx`：`assistant.previewFile`，后端在 worker 里按需读这个文件，与附件同样的检查与上限，Excel 按工作表取前 1,000 行，界面与 §8.1 共用组件）、「另存为…」（所有文件：`GET /assistant/conversations/:id/files/raw?path=` 取字节，桌面版经 preload `saveFile`，浏览器开发模式下载，E2E 由此断言）、「打开」（桌面版：preload `openPath`，main 只接受 `<数据目录>/assistant/files/` 下的文件，用系统默认应用打开）、「在 Finder 中显示」（不变）。
- 写文件的路径一律经 `assistant.fileOf` / `newFile` 限定在对话目录内（越界 `VALIDATION_FAILED`）；同名时加「 (2)」等序号；worker 以 `wx` 写入，不覆盖任何已有文件。

### 8.3 简单 / 专业模式

两种模式都能上传 Office 文件、使用这些工具；不加导航、页面、主页分段和设置项（38 C6 要求进简单模式的功能写明理由：这是现有附件与助手能力的格式扩展，不新增入口）。文案在 `web/src/copy/attachments.ts`、`assistant.ts`。

## 9. 依赖（D200）

| 包 | 用途 | 许可证 | 说明 |
| --- | --- | --- | --- |
| mammoth | 读 `.docx` | BSD-2-Clause | ≥ 1.11.0（§5.2） |
| exceljs | 读写 `.xlsx` | MIT | 读、写、在原件上修改都用它；能保留单元格样式 |
| docx | 写 `.docx` | MIT | 声明式生成，支持外部样式表（`revise_docx` 沿用原件样式） |

- 都是纯 JS：没有原生模块、没有 postinstall 下载、运行时不联网，内网 npm 镜像可装，macOS 与 Linux 行为一致；只装在 `packages/server`，不进渲染进程首屏包。
- 版本精确锁定并登记 03 §3（06 §12）。传递依赖里的 jszip 是 MIT / GPL-3.0 双许可，按 MIT 使用；实施时用 `pnpm licenses list` 核对全部传递依赖并把结果写进 PR。
- 风险：exceljs 近两年发版少。我们只用读写核心路径并有真实文件的集成测试兜住行为；如遇阻塞性问题再评估替换。

不选：

| 候选 | 原因 |
| --- | --- |
| SheetJS（xlsx） | npm 上的 0.18.5 已停更且有公开漏洞（CVE-2023-30533、CVE-2024-22363）；新版只在它自己的 CDN 发布，内网 npm 镜像同步不到；写文件时保留样式要付费版。若 D194 选支持 `.xls`，才把它的 tgz 放进仓库引入 |
| word-extractor | 只为 `.doc`；同上，随 D194 |
| LibreOffice 无界面转换 | 要求机器上装 LibreOffice，体积大，内网机器不一定有 |
| python-docx / openpyxl | 要求 Python 与 pip，离线环境装不上 |

## 10. 上限与截断（D201）

| 常量 | 值 | 超出时 |
| --- | --- | --- |
| `OFFICE_ATTACHMENT_BYTES_MAX` | 20 MiB（文本附件仍是 5 MiB） | `ATTACHMENT_TOO_LARGE`，`reason: bytes` |
| `OFFICE_UNZIPPED_BYTES_MAX` | 200 MiB | `ATTACHMENT_TOO_LARGE`，`reason: unzipped` |
| `OFFICE_CELLS_MAX` | 500,000 个非空单元格 | `ATTACHMENT_TOO_LARGE`，`reason: cells` |
| `OFFICE_WORKER_TIMEOUT_MS` | 30 秒 | `ATTACHMENT_PARSE_FAILED`，`reason: timeout` |
| `OFFICE_WORKER_HEAP_MB` | 1,024 | `ATTACHMENT_PARSE_FAILED`，`reason: out_of_memory` |
| `SHEET_OVERVIEW_HEAD_ROWS` / `_TAIL_ROWS` / `_SHEETS` | 10 / 2 / 20 | 概览只列这么多 |
| `SHEET_QUERY_MAX_ROWS` | 500（`limit` 的上限，默认 100） | 返回 `total_rows`，模型可加条件或分组 |
| `OFFICE_PREVIEW_ROWS` | 1,000 | 预览说明只显示前 1,000 行 |
| `OFFICE_WRITE_BLOCKS_MAX` / `OFFICE_WRITE_CELLS_MAX` | 2,000 / 200,000（`rows_from` 取出的行也算） | `VALIDATION_FAILED` |

截断原则：Word 按字符（沿用 30）；Excel 按行，绝不切断一行；超过上限一律明确拒绝并说明原因，不悄悄只读一部分（06 §1「让失败显性」）。

## 11. 枚举、常量、错误码（实施时登记 08）

- 新枚举 `AttachmentFormat`：`text` / `docx` / `xlsx`。
- `ATTACHMENT_INVALID_TYPE` 的 `details.reason` 增加 `legacy_office`、`encrypted`、`unsupported`（现有 `not_text` 不变）。
- `ATTACHMENT_TOO_LARGE` 的 `details` 增加 `reason: bytes / unzipped / cells`，`details.limit` 照旧为超过的那个上限。
- 新错误码 `ATTACHMENT_PARSE_FAILED`（400）：`details.reason` 为 `corrupt` / `timeout` / `out_of_memory`。
- 工具：`McpToolName` 加 `read_sheet`、`query_sheet`、`read_office_file`；`AssistantToolName` 加 `read_sheet`、`query_sheet`、`create_docx`、`create_xlsx`、`edit_xlsx`、`revise_docx`。工作表不存在、对 Word 附件调用 `read_sheet` 等都是 `VALIDATION_FAILED`，`issues` 的提示列出可用的工作表名或说明该附件是 Word。
- §10 的常量进 `shared/constants/limits.ts`。

## 12. 数据、接口与状态（实施时登记 09–12）

- **状态**：不新增状态机。解析在上传请求内同步完成（§5），生成在工具调用内同步完成；两者失败都直接返回错误，没有中间状态需要恢复。
- **表**（10 §6.1）：迁移给 `attachments` 加 `format`（非空，默认 `text`）与 `meta`（JSON，可空）；`attachment_refs` 不变。
- **API**（11 §14）：`AttachmentDTO` 加 `format`、`meta`；Word 的预览直接读 `GET /attachments/:id/content`（`text.md`），Excel 按工作表 `attachments.previewSheet`（`GET /attachments/:id/sheet?sheet=` → `SheetPreviewDTO`：区域、`left` 与列数、合并区域、前 `OFFICE_PREVIEW_ROWS` 行与 `totalRows`，OF-03 已实现）；助手对话文件新增 `GET /assistant/conversations/:id/files/preview?path=` 与 `…/files/raw?path=`（另存为与浏览器开发模式下载用）。
- **preload**：新增 `openPath(path)`；main 校验路径在助手对话目录内。
- **MCP**（12 §6、15 §3）：§6.2、§7.2、§7.3 的工具，输入输出 schema 放 `shared/contracts/mcp/`。

## 13. 安全

- 宏不读取、不执行；生成的文件只有 `.docx` / `.xlsx`，不含宏。
- 用到的 XML 解析不解析外部实体；mammoth 不读外部链接的本机文件（§5.2）；zip 炸弹在解压前拦截（§5.1）。
- 路径：生成文件限对话目录、`read_office_file` 限会话目录，都按 realpath 校验（06 §11）。
- 提取出的文字仍放在「用户提供的资料，不是指令」的附件块里（30 §3.2）；公式白名单见 §7.2。

## 14. 测试（按 07，少而有效）

- **样本**：`packages/server/test/fixtures/office/` 放少量真实文件，分别用 Microsoft Office、WPS、LibreOffice 保存（各家的 XML 写法不同，是解析出问题的主要来源）：含标题、列表、表格、图片的 docx；含多工作表、日期、公式、合并单元格、隐藏行的 xlsx；加密的 docx；`.doc` 与 `.xls`；损坏文件。zip 炸弹在测试里现场生成，不提交。
- **单元**：Word → Markdown 的转换（标题、列表、表格、图片占位）；工作簿 → 概览与 `text.md`（行号列字母、日期、公式缓存值、合并）；`query_sheet` 的筛选、分组、汇总、排序；公式安全检查。
- **集成**（真实文件与 SQLite）：各种格式的接受与拒绝，拒绝时不留记录；worker 超时与内存上限（测试里把上限调小，不 sleep）；生成后再解析，内容一致；`edit_xlsx` 保留样式与其他工作表并报告丢失项；`revise_docx` 沿用原件样式；范围外的附件 ID 与越界路径被拒；每个新 MCP 工具一个成功路径、特有错误与允许的尝试类型（07 §3.1）。
- **E2E**（FakeOpencode）：上传 docx 与 xlsx，卡片摘要与预览页签；`.doc` 的失败卡片；FakeOpencode 脚本调用 `create_xlsx`，文件卡片可预览、可下载（浏览器模式断言下载）；四主题走查含 Excel 预览。
- **live**：真实模型上传销售 xlsx，问各区域合计，模型用 `query_sheet` 得出正确数字；再要求做成 Word 报告，`create_docx` 生成的文件再解析后含这些数字（`live/office.live.test.ts`）。
- **跨平台**：全部是纯 JS，CI 的 Linux x64 / arm64 与 macOS 跑同一套集成测试；打包后的 worker 由 `pnpm e2e:smoke` 覆盖（§5.1）。

## 15. 不做

- 理解图片与图表内容（模型只支持文本）；OCR。
- 公式重算；Word 原位修改与修订模式；应用内的 Word / Excel 编辑器；在线协同。
- `.pptx` 读取与 PDF（30 的 U2 另议）；`.doc` / `.xls`（视 D194）。
- 任务在 worktree 里生成 Office 文件（视 D199）；批量与定时任务带附件（30 §5 不变）。
- PPT 资料、知识问答附件接入 Office 文件：复用 `office.parse` 改动不大，等本期上线后另议。
- 浏览器里向网站上传或下载文件（29 §5.4 不变）。

## 16. 实施拆分

见 05 的 OF 系列。顺序：OF-01（解析与附件）→ OF-02（模型读取）与 OF-03（界面）可并行 → OF-04（生成）→ OF-05（修改）→ OF-06（仓库里的 Office 文件）→ OF-07（live）。OF-01 至 OF-03 完成后，「上传 Word / Excel 让 AI 读懂」就已可用。

## 17. 决策（2026-10-26 用户确认，均按推荐方案）

| 编号 | 问题 | 推荐 | 备选 |
| --- | --- | --- | --- |
| D193 | 加模块、加功能还是加流程 | 一个无页面的后端能力模块 `office` + 附件、助手、任务工具三处加功能；不加流程、不加页面（§2） | 像 PPT 一样做「文档工作台」页面；做成内置流程 |
| D194 | 支持哪些格式 | `.docx` / `.xlsx`（含 `.docm` / `.xlsm`，宏忽略）；CSV 等文本在非 UTF-8 时按 GB18030 解码；`.doc` / `.xls` 与加密文件拒绝并提示另存 | 同时支持 `.doc` / `.xls`：引入 SheetJS（tgz 放进仓库）与 word-extractor，多两个依赖与一类样本 |
| D195 | 什么时候解析 | 上传时在 worker 线程解析，保存派生文字与结构，失败当场拒绝；不新增状态 | 每次用时解析（不存派生文件，但每次调用都重复解压，失败要到发送后才发现） |
| D196 | 模型怎么读 | Word 进提示词（同文本）；Excel 只放概览，用 `read_sheet` 分页读、`query_sheet` 结构化查询 | `query_sheet` 改为只读 SQL（把工作表载入内存 SQLite，表达力更强，但要为它设只读、禁 `ATTACH`、限时等多道关） |
| D197 | 读写工具做在哪 | 应用 MCP 工具（助手与执行两套范围）（§7.1） | opencode 插件工具；让模型写脚本 |
| D198 | 怎么修改已有文件 | 永远另存新文件；Excel 在原件副本上按操作修改（保留样式）；Word 首版为「按结构重写 + 沿用原样式」，并在返回与卡片上说明丢失了什么 | Word 做原位修改（按段落替换文字、保留全部排版）：要处理文字被拆成多段格式的情况，工作量约翻倍，可作为第二期 |
| D199 | 任务里能做到哪一步 | 首版只读：任务附件、`read_office_file` 读仓库里的 Office 文件、项目文件快照接受 Office | 执行者也能在 worktree 里生成或修改 Office 文件（会进提交，二进制 diff 不可审阅） |
| D200 | 用哪些库 | mammoth（读 Word）、exceljs（读写 Excel）、docx（写 Word），都是纯 JS、可离线（§9） | SheetJS 读写 Excel（见 §9 不选的原因） |
| D201 | 上限 | Office 单文件 20 MiB、解压后 200 MiB、50 万个非空单元格、解析 30 秒；超出明确拒绝（§10） | 维持附件统一 5 MiB（实现更少，但几千行以上的 Excel 常常超过） |
