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
| AP-05 | 用量、耗时与运行约束 | 显示实际 token 用量及耗时；中断、错误、重启有一致记录；必要的运行限制明确生效且可理解，无金额预算功能 | 用量功能验证通过；正在修复真实运行时复现的停止与迟到事件竞态 |
| AP-06 | 真实多轮助手评测 | 覆盖文本理解、任务创建确认及回传、网页读取、目录隔离与停止；记录工具选择、错误和真实模型证据，修复实际复现问题 | 真实多轮脚本完成，待依赖合入后运行 |
| AP-07 | 最终验证与明早验收说明 | 串行合并后完整 verify、浏览器 E2E、真实 opencode / Electron 验证；记录 PR、提交、测试、已知限制及用户检查入口 | 进行中 |
| AP-L1 | 截图、PDF、视觉输入 | 用户明确暂缓 | 暂缓 |
| AP-L2 | 长期记忆 | 先确定保存 / 查看 / 修改 / 删除边界 | 后续设计 |
| AP-L3 | 更强连续自主行动 | 自动重试、继续推进与权限边界另行设计 | 后续设计 |
| AP-L4 | 工具分层与路由重构 | 先由 AP-06 的真实工具选择数据证明必要性 | 按评测结果决定 |

## 合并与验证约束

- AP-01、AP-02、AP-03a 可并行实现，按顺序评审合并。其余切片依赖最新 main 后再合入。
- 新数据库迁移以实际 main 为基线由 drizzle-kit 生成，不改已合并迁移。已合并 0019（任务回传）与 0020（会话隔离）；后续迁移继续基于最新主干生成。
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

待完成项仍需集成、真实模型验证或最终主干验收；未完成状态不代表已经交付。

## 并行开发的边界

只读确认 Claude 的 [B2 PR #63](https://github.com/wangyufengsky/agent-workflow/pull/63) 尚未合并，包含完整页面体检、AI 动作画面与更完整的任务预览。该 PR 已说明与主干存在冲突。本轮 AP-03b 只补助手读取明确用户页面所需的预览入口、归属和文本读取，不代表整套 B2 已完成；没有操作 PR #63 或其分支。后续合并 B2 时需统一重名的用户浏览器接口并重新验证，不应直接叠加两套实现。
