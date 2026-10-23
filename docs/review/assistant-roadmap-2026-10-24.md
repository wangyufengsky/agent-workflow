# 助手产品能力待办与交付记录 · 2026-10-24

## 范围与工作方式

用户授权本轮按独立分支 / worktree → 开发与回归测试 → PR → 评审与验证 → 合并 main 推进，可并行开发、串行合并。主目录与 Claude 的分支、工作区不作开发用途。起点：`origin/main` 的 `de31a2c`（已包含此前四个助手缺陷修复）。

本清单属于第四节「产品能力缺口」的后续改进。截图、PDF、视觉输入暂缓；长期记忆、自动重试及更强的连续自主行动需要另行设计，不在本轮实施。助手不得把任务到达待验收描述成已合并或已交付。

## 完整待办

| 编号 | 工作 | 完成标准 | 当前状态 |
| --- | --- | --- | --- |
| AP-01 | 普通任务结果回传原对话 | 创建任务和来源关联原子保存；确认 / 总是允许路径一致；待验收、失败、完成回传；重复事件去重，忙碌排队，重启恢复，不重新执行业务 | 已合并 · PR #60 |
| AP-02 | 用户主动附上文本上下文 | 当前任务 / 步骤详情、报错与选中文字可预览、移除后再发送；来源与时间明确；有界文本、凭据字段排除；主页、侧栏与桌宠共用附件链路 | 已合并 · PR #61 |
| AP-03a | 助手只读网址与预览服务操作 | browser.readUrl 强制只读、沿用网站策略和登录分区、读取后清理；预览状态可查、启停走既有写操作确认 | 已合并 · PR #62 |
| AP-03b | 显式用户预览页与当前页文本读取 | 先补当前代码缺失的用户预览页签及归属；读取用户明确打开的页面文本、控制台与请求错误；无预览页返回明确错误，不猜测 AI 页签；不增加助手点击或视觉输入 | 已合并 · PR #66 |
| AP-04 | 会话文件目录隔离与删除清理 | 原生会话只在自身文件目录运行；旧会话有明确兼容路径；删除聊天清理底层 opencode 会话与本地资源；真实运行时验证路径边界及删除 | 已合并 · PR #64 |
| AP-05 | 用量、耗时与运行约束 | 显示实际 token 用量及耗时；中断、错误、重启有一致记录；必要的运行限制明确生效且可理解，无金额预算功能 | 已合并 · PR #67 |
| AP-06 | 真实多轮助手评测 | 覆盖文本理解、任务创建确认及回传、网页读取、目录隔离与停止；记录工具选择、错误和真实模型证据，修复实际复现问题 | 已合并 · PR #68；两组成功样本与首次失败均留证 |
| AP-07a | 终验发现的桌面退出超时 | 保留原始失败与 trace；定位应用退出根因，补回归后按独立分支 / PR 合并；不放宽超时或重试掩盖 | 修复中：已用真实 Electron 预连接稳定复现退出等待环 |
| AP-07 | 最终验证与明早验收说明 | 串行合并后完整 verify、浏览器 E2E、真实 opencode / Electron 验证；记录 PR、提交、测试、已知限制及用户检查入口 | 进行中 |
| AP-L1 | 截图、PDF、视觉输入 | 用户明确暂缓 | 暂缓 |
| AP-L2 | 长期记忆 | 先确定保存 / 查看 / 修改 / 删除边界 | 后续设计 |
| AP-L3 | 更强连续自主行动 | 自动重试、继续推进与权限边界另行设计 | 后续设计 |
| AP-L4 | 工具分层与路由重构 | 先由 AP-06 的真实工具选择数据证明必要性 | 本轮不重构；记录多余工具调用，后续扩样本再决定 |

## 合并与验证约束

- AP-01、AP-02、AP-03a 可并行实现，按顺序评审合并。其余切片依赖最新 main 后再合入。
- 新数据库迁移以实际 main 为基线由 drizzle-kit 生成，不改已合并迁移。已按合并顺序生成并合并 0019（任务回传）、0020（会话隔离）、0021（助手用量）；既有迁移未改写。
- 本轮 agent 之间协调完整集成、Chromium、Electron 与真实 opencode 测试时段，集成并发限制为 2。其他会话也可能同时测试，未操作它们的工作区与进程；发生失败时保留证据查根因。
- 当前 GitHub Actions 只有 workflow_dispatch；推送与 PR 不自动运行。按 07 / 17 的现行规范，以本机 macOS 验收为准，跨平台矩阵不伪报为已通过。
- 每个实现 PR 更新权威契约文档和测试证据；合并后再验证最终组合。FakeOpencode 与截图不是模型能力验收。

## 工作区与证据索引

| 用途 | 分支 | 工作区 |
| --- | --- | --- |
| 计划 / AP-04 / 最终集成 | codex/assistant-roadmap → codex/assistant-session-lifecycle → codex/assistant-final-verification | Codex 管理的 assistant-roadmap/agent-workflow-dev |
| AP-01 | codex/assistant-task-relay | Codex 管理的 assistant-task-relay/agent-workflow-dev |
| AP-02 | codex/assistant-text-context | Codex 管理的 assistant-text-context/agent-workflow-dev |
| AP-03a | codex/assistant-browser-read | Codex 管理的 assistant-browser-read/agent-workflow-dev |
| AP-03b | codex/assistant-user-preview | Codex 管理的 assistant-user-preview/agent-workflow-dev |
| AP-05 | codex/assistant-usage-limits | Codex 管理的 assistant-usage-limits/agent-workflow-dev |
| AP-06 | codex/assistant-real-evaluation | Codex 管理的 assistant-real-evaluation/agent-workflow-dev |

## 已合并记录

| 内容 | PR | 合并提交 | 证据 |
| --- | --- | --- | --- |
| 计划与范围 | [#59](https://github.com/wangyufengsky/agent-workflow/pull/59) | `ec1e350` | 本文 |
| AP-01 任务回传 | [#60](https://github.com/wangyufengsky/agent-workflow/pull/60) | `f540ceb` | [回传验证](assistant-task-relay-validation-2026-10-24.md) |
| AP-02 文本上下文 | [#61](https://github.com/wangyufengsky/agent-workflow/pull/61) | `559d6c0` | [文本验证](assistant-text-context-validation-2026-10-24.md) |
| AP-03a 只读网址 | [#62](https://github.com/wangyufengsky/agent-workflow/pull/62) | `0c3f197` | [浏览器验证](assistant-browser-read-validation-2026-10-24.md) |
| AP-04 会话隔离 | [#64](https://github.com/wangyufengsky/agent-workflow/pull/64) | `0ccb735` | [生命周期验证](assistant-session-lifecycle-validation-2026-10-24.md) |
| AP-03b 用户预览 | [#66](https://github.com/wangyufengsky/agent-workflow/pull/66) | `7b7bcb8` | [预览验证](assistant-user-preview-2026-10-24.md) |
| AP-05 用量与停止控制 | [#67](https://github.com/wangyufengsky/agent-workflow/pull/67) | `c2044b7` | [用量验证](assistant-usage-validation-2026-10-24.md) |
| AP-06 真实多轮评测 | [#68](https://github.com/wangyufengsky/agent-workflow/pull/68) | `739ee40` | [真实评测记录](assistant-real-evaluation-2026-10-24.md) |

待完成项仍需集成、真实模型验证或最终主干验收；未完成状态不代表已经交付。

## 并行开发的边界

只读确认 Claude 的 [B2 PR #63](https://github.com/wangyufengsky/agent-workflow/pull/63) 尚未合并，包含完整页面体检、AI 动作画面与更完整的任务预览。该 PR 已说明与主干存在冲突。本轮 AP-03b 只补助手读取明确用户页面所需的预览入口、归属和文本读取，不代表整套 B2 已完成；没有操作 PR #63 或其分支。后续合并 B2 时需统一重名的用户浏览器接口并重新验证，不应直接叠加两套实现。

## 真实评测目前确认的局限

AP-06 观察到模型偶尔为明确的任务创建请求额外申请项目 shell 读取，另一个网址轮额外调用了尚未打开的当前预览读取工具。这些调用没有绕过权限；首次测试因未模拟权限答复而超时，完整失败报告保留。补齐模拟用户答复后，新的任务样本直接创建成功，因此不能把它写成“已验证首轮拒绝 shell 后恢复”。

真实任务的实际文件和 Git 断言正确，检查通过；但任务执行摘要把 `hello\n` 的六个字节写成七字节，助手回传沿用了该描述。模型摘要仍可能传播细节错误，应以实际文件、检查和交付状态为准。两个多轮案例提供场景证据，不代表广泛能力基准，也不足以直接决定工具路由架构重构。

## 合并后最终验证

功能主干固定为 `c2044b7b8a0810139fe3a3749b953ad294b150a1`，在干净的独立 Codex 工作区执行完整终验。随后 AP-06 合并为 `739ee40`，只新增真实评测脚本与报告；逐项比对确认除 `live/`、`docs/` 外，终验源码与该主干没有差异。最终交付分支也只修改文档。AP-06 合并后的完整 `pnpm check` 及独立评测 TypeScript 检查另行通过。

| 合并后检查 | 结果 | 耗时 |
| --- | --- | ---: |
| 静态检查 | 类型、Biome、依赖边界、CSS、状态机文档同步全部通过 | 墙钟 16.16 秒 |
| 全量单元 | 59 文件，725 项通过 | Vitest 5.24 秒 |
| 全量集成，最多 2 worker | 63 文件，375 项通过、1 项不适用场景跳过 | Vitest 125.40 秒 |
| 生产构建 | 插件、桌面构建及生产 bundle 检查通过 | 墙钟 3.36 秒 |
| 浏览器 E2E，1 worker、0 retry | 56 项通过，无跳过或 flaky | 328.925 秒 |
| 原生 OpenCode 全套 | 5 文件，9 项通过 | Vitest 46.23 秒 |
| Electron 全套，1 worker、0 retry | 最新原始代码全套 11 项通过；此前两轮同一退出超时仍在定位，不能据此称已修复 | 最新 106.400 秒；先前失败 180.767 / 159.132 秒 |

唯一集成跳过是 SQL Server 的「主键 INCLUDE 列不标为主键」，由 `includedColumnTable` 的适用条件决定，不是缺少数据库环境。数据库引擎的其他用例实际运行。浏览器四主题各 78 个页面、共 312 张截图，对比度与横向溢出检查均为零；另人工抽查每套主题的助手面板。

日志、JSON、trace 与截图保留在本机 `/private/tmp/aw-final-acceptance/postmerge-*`。AP-06 合并后的新增文件静态检查分别为 `final-evaluation-check.log`、`final-evaluation-tsc.log`。本轮没有手动触发 GitHub Actions；以上是现行规范要求的本机 macOS 验收，Windows / Linux 与安装包验收未在本轮运行。


Electron 首轮的桌宠用例已完成会话/形象同步、拖动、主窗恢复和截图，禁用设置已持久化；超时范围位于后续关闭事件等待或应用退出。首轮未启用 Electron trace，JSON 未给出具体调用栈。相同源码单例开启 `pw:api` 与 trace 后通过，PATCH、桌宠关闭事件和应用退出均完成（退出 467 ms），这只能说明没有复现，不能声称问题已修复。首次失败与后续诊断证据分别保留，未延长超时或削弱断言。


随后在最新主干 `739ee40` 的独立诊断分支中按原顺序执行前七条桌面用例，只临时记录关闭阶段事件：7/7 通过（15.906 秒），原生桌宠 `contents.destroyed/window.closed`、Playwright `pet.close` 先后相隔约 1–2 ms，应用最终退出码 0。临时日志代码已恢复，工作树干净，没有据此改动产品或延长超时。随后恢复原始测试，在该干净主干上开启详细 trace 的完整 Electron 再次出现同一超时（10 项通过、1 项超时）。调用链确认 PATCH 已完成、桌宠关闭事件已收到、窗口数量断言已通过；挂起的是 `e2e/companion.electron.spec.ts:95` 的 `finally await app.close()`。因此单例与顺序诊断通过不代表修复；AP-07a 继续聚焦应用退出、后端停止与 Playwright 收尾链，不延长超时或增加重试。


完全恢复诊断前的生产与测试源码、重新构建后，外部观察器下的原始完整 Electron 套件 11/11 通过（106.400 秒，墙钟 107.18 秒，0 retry）。观察器只跟踪本次测试派生的进程，未进入产品或改变测试断言；本轮未出现挂起，因此没有捕捉到失败现场。带临时阶段日志的其他诊断通过不能作为产品修复。此前两次失败仍保留，AP-07a 继续以 OpenCode 尚在启动时退出这一共同阶段做受控验证。


后续受控实验排除了 OpenCode 初始化门闩：真实运行时保持 `starting` 时后端在 20 ms 内关闭。真实 TCP 零字节连接及未完整请求头则均阻止 `app.close()`，销毁实验连接后立即结束。进一步由 Electron 默认会话 `preconnect` 建立到本后端的连接，确认应用退出等待 5 秒仍有双端 `ESTABLISHED`；仅关闭该默认会话的连接后，主进程在 136 ms 内退出，`app.close()` 在 151 ms 内完成。AP-07a 将据此在窗口关闭后先释放默认会话的网络连接，再等待后端正常收尾。该动作会取消默认会话的在途请求，不是只关闭空闲连接；独立网站分区不扩大处理。正式回归与修复 PR 待完成。
