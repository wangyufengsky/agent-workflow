# agent-workflow 文档索引

> 状态：v1.0 开发完成（M0–M6，2026-10-20），验收见 [16-acceptance-v1.0.md](16-acceptance-v1.0.md)；进度与各里程碑的差异见 [05-dev-plan.md](05-dev-plan.md)。

agent-workflow 是一个本地桌面应用：选项目、选流程、写一句需求，AI（托管的 opencode 1.19.0）在独立 Git worktree 中完成开发，用户查看结果并决定是否合并。默认简单，专业能力可选开启。

| 文档 | 内容 | 读者 |
| --- | --- | --- |
| [01-product.md](01-product.md) | 产品定义、简单/专业模式、v1.0 交付范围与验收 | 全员 |
| [02-decisions.md](02-decisions.md) | 已确认决策记录（含讨论结论） | 全员 |
| [03-architecture.md](03-architecture.md) | 技术选型、进程拓扑、模块划分、目录结构、依赖清单 | 开发 |
| [04-project-plan.md](04-project-plan.md) | 里程碑、工期、风险 | 全员 |
| [05-dev-plan.md](05-dev-plan.md) | 技术验证项与逐里程碑任务分解、完成标准 | 开发 |
| [06-coding-standards.md](06-coding-standards.md) | 代码开发规范 | 开发 / AI 助手 |
| [07-testing-standards.md](07-testing-standards.md) | 测试规范 | 开发 / AI 助手 |
| [08-enums-and-errors.md](08-enums-and-errors.md) | 枚举、常量、错误码 | 开发 |
| [09-state-machines.md](09-state-machines.md) | 任务 / 节点 / 尝试等状态机 | 开发 |
| [10-data-model.md](10-data-model.md) | SQLite 表结构与 JSONL 日志布局 | 开发 |
| [11-api.md](11-api.md) | 后端 REST API 与 SSE 事件 | 开发 |
| [12-mcp-tools.md](12-mcp-tools.md) | 内部 MCP 工具定义与 opencode 集成 | 开发 |
| [13-builtin-workflows.md](13-builtin-workflows.md) | 内置流程与内置角色 | 开发 / 产品 |
| [14-ui-spec.md](14-ui-spec.md) | 页面与路由、简单/专业模式界面、主题配置、设计稿改进 | 开发 / 设计 |
| [15-assistant.md](15-assistant.md) | 应用助手（v1.1）设计与 v1.0 预留 | 全员 |
| [16-acceptance-v1.0.md](16-acceptance-v1.0.md) | v1.0 验收报告：01 §5 逐条的验证方法、结果与证据，需要用户完成的项 | 全员 |
| [18-knowledge.md](18-knowledge.md) | 知识问答（v1.1）：页面、数据、API、研究员与引用校验 | 全员 |
| [19-insights.md](19-insights.md) | 质量与用量（v1.1）：指标口径、页面与钻取、API、性能 | 全员 |
| [20-batch-tasks.md](20-batch-tasks.md) | 固定模板批量任务（v1.1）：创建、目标、并发、批量视图与批量交付 | 全员 |
| [21-review-feedback.md](21-review-feedback.md) | PR 审查意见回流（v1.2）：取回意见、按意见修改、推送回同一个 PR | 全员 |
| [22-scheduled-tasks.md](22-scheduled-tasks.md) | 定时任务（v1.2）：频率与时区、到点运行、补跑与跳过、失败暂停、页面、数据与 API | 全员 |
| [23-ppt.md](23-ppt.md) | PPT 制作（v1.2）：场景、大纲与逐页制作、版式与主题、导出、与助手 | 全员 |
| [25-conversation-stream.md](25-conversation-stream.md) | 会话流重设计（v1.2 体验修正）：共用的固定高度会话流、思考显示、结束后收起、增量存储（D102–D104） | 开发 / 设计 |
| [26-canvas.md](26-canvas.md) | 流程画布与流程页重设计：视图控件、自动布局、节点卡片、+ / − 编辑、流程编辑页 | 开发 / 设计 |
| [27-git-workbench.md](27-git-workbench.md) | Git 工作台（重做，v1.2）：手动提交 / 推送 / 合并、AI 审查、与任务 worktree 的边界、三栏界面 | 全员 |

## 维护规则

- 改枚举、状态机、API、MCP 工具、表结构时，**同一个提交**更新对应文档。
- 文档只写结论和约束，不写过程记录；过程讨论结论进 `02-decisions.md`。
- 设计稿 `opencode-workflow-design-showcase/` 只作为视觉与交互参考，以本目录文档为准；二者冲突时按 [14-ui-spec.md](14-ui-spec.md) 的改进清单执行。
