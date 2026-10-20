# agent-workflow · AI 编码助手须知

当前阶段：**M3（任务主链路·简单模式）已完成，下一步 M4**。开始任何开发任务前，先读：

1. `docs/06-coding-standards.md`：找根因不兜底、不过度防御、状态只经状态机、一处定义。
2. `docs/07-testing-standards.md`：测行为不测实现、少而有效、真实 SQLite/Git、缺陷先写失败测试、禁止 sleep。
3. `docs/05-dev-plan.md` 中你所做任务的条目，以及它引用的文档章节。

权威来源：枚举与错误码 `docs/08`，状态机 `docs/09`，表结构 `docs/10`，API `docs/11`，MCP 工具 `docs/12`。改动这些内容时同一提交更新文档。

`opencode-workflow-design-showcase/` 只是视觉参考，与 `docs/14-ui-spec.md` 冲突时以后者为准。

文档、注释与界面文案用中文；代码标识符、日志消息、提交信息用英文。

常用命令：`pnpm dev`（桌面开发）、`pnpm verify`（提交前全量检查：类型、lint、依赖边界、单元与集成测试、构建）、`pnpm e2e`、`pnpm e2e:electron`（需先 `pnpm build`）、`pnpm test:oc` 与 `pnpm test:live`（真实 opencode；默认免费模型 `opencode-go/beam-free`，`AW_OC_TEST_MODEL` 可覆盖）。
