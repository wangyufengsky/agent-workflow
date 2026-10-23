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
| AP-07a | 终验发现的桌面退出超时 | 保留原始失败与 trace；定位应用退出根因，补回归后按独立分支 / PR 合并；不放宽超时或重试掩盖 | 已合并 · PR #69；真实预连接回归先红后绿 |
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
| AP-07a 退出修复 | codex/assistant-desktop-close-diagnostics | Codex 管理的 assistant-user-preview/agent-workflow-dev |

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
| AP-07a 桌面退出修复 | [#69](https://github.com/wangyufengsky/agent-workflow/pull/69) | `1ed178a` | [根因与红绿回归](desktop-preconnect-shutdown-2026-10-24.md) |

能力切片与退出修复均已合并；AP-07 正在同一最终主干上完整验收，尚未预填通过结果。

## 并行开发的边界

只读确认 Claude 的 [B2 PR #63](https://github.com/wangyufengsky/agent-workflow/pull/63) 尚未合并，包含完整页面体检、AI 动作画面与更完整的任务预览。该 PR 已说明与主干存在冲突。本轮 AP-03b 只补助手读取明确用户页面所需的预览入口、归属和文本读取，不代表整套 B2 已完成；没有操作 PR #63 或其分支。后续合并 B2 时需统一重名的用户浏览器接口并重新验证，不应直接叠加两套实现。

## 真实评测目前确认的局限

AP-06 观察到模型偶尔为明确的任务创建请求额外申请项目 shell 读取，另一个网址轮额外调用了尚未打开的当前预览读取工具。这些调用没有绕过权限；首次测试因未模拟权限答复而超时，完整失败报告保留。补齐模拟用户答复后，新的任务样本直接创建成功，因此不能把它写成“已验证首轮拒绝 shell 后恢复”。

真实任务的实际文件和 Git 断言正确，检查通过；但任务执行摘要把 `hello\n` 的六个字节写成七字节，助手回传沿用了该描述。模型摘要仍可能传播细节错误，应以实际文件、检查和交付状态为准。两个多轮案例提供场景证据，不代表广泛能力基准，也不足以直接决定工具路由架构重构。

## 终验发现并修复的退出问题

先前在 `c2044b7` / `739ee40` 上的完整 Electron 验收，两次在桌宠用例 `finally app.close()` 超时，业务断言已经通过。后来的单例、顺序诊断和一轮原始完整 11/11 通过均保留，但未据此宣称已修复。

受控实验最终稳定复现了默认会话预连接的等待环：NetworkService 持有未发送 HTTP 请求的连接，后端等待连接关闭，main 又等待后端退出。仅释放默认会话连接即可使应用正常结束。PR #69 调整退出顺序，并新增真实 TCP 转发 + Electron 永久回归，旧代码先失败、修复后与原启动及桌宠用例一起 3/3 通过。退出会取消本应用默认会话中的在途请求，再走原有后端清理；没有扩大到其他网站分区，也未增加超时、重试或强杀。

原始失败没有实时 socket 现场，因此受控实验确认的是可确定复现、与原症状一致的退出等待环。完整诊断、排除项、首次测试观察器错误与正式回归证据见 [桌面退出修复记录](desktop-preconnect-shutdown-2026-10-24.md)。

## 合并后最终验证

最终功能基线固定为 `1ed178a95fecddd57c8ae700599040944283e52b`，包含所有能力切片、真实评测代码和退出修复。完整静态检查、单元、集成、构建、浏览器、OpenCode 和 Electron 正在该干净主干上串行执行；本节待结果后填写。交付说明分支仅修改文档。

先前 `c2044b7` 的完整检查、725 项单元、375 项集成、56 项浏览器和 9 项 OpenCode 已通过；该批结果属于退出修复之前，不混记为最终基线。日志、JSON、trace 与截图保留在本机 `/private/tmp/aw-final-acceptance/postmerge-*`，修复后的最终证据使用 `final-release-*`。

唯一集成条件跳过是 SQL Server 的「主键 INCLUDE 列不标为主键」，由 `includedColumnTable` 的适用条件决定，不是缺少数据库环境。数据库引擎的其他用例实际运行。本轮没有手动触发 GitHub Actions；按现行规范进行本机 macOS 验收，Windows / Linux 与安装包验收未在本轮运行。
