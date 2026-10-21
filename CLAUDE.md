# agent-workflow · AI 编码助手须知

当前阶段：**v1.0 完成（M0–M6）**，验收报告见 `docs/16-acceptance-v1.0.md`；下一步 v1.1 应用助手（`docs/15-assistant.md`）。开始任何开发任务前，先读：

1. `docs/06-coding-standards.md`：找根因不兜底、不过度防御、状态只经状态机、一处定义。
2. `docs/07-testing-standards.md`：测行为不测实现、少而有效、真实 SQLite/Git、缺陷先写失败测试、禁止 sleep。
3. `docs/05-dev-plan.md` 中你所做任务的条目，以及它引用的文档章节。

权威来源：枚举与错误码 `docs/08`，状态机 `docs/09`，表结构 `docs/10`，API `docs/11`，MCP 工具 `docs/12`。改动这些内容时同一提交更新文档。

`opencode-workflow-design-showcase/` 只是视觉参考，与 `docs/14-ui-spec.md` 冲突时以后者为准。

文档、注释与界面文案用中文；代码标识符、日志消息、提交信息用英文。

常用命令：`pnpm dev`（桌面开发；端口 47821 / 47822 被别的 worktree 占用时用 `AW_DEV_API_PORT` / `AW_DEV_WEB_PORT` 换一组）、`pnpm verify`（提交前全量检查：类型、lint、依赖边界、单元与集成测试、构建；数据库集成测试需要本机 Docker 与 `mysql:8.4` 镜像）、`pnpm e2e`（含四主题走查，截图在 `screenshots/walkthrough/`；后端用系统分配的端口，多个 worktree 可同时运行，D77）、`pnpm e2e:electron`（需先 `pnpm build`；真实 opencode 与模型）、`pnpm test:oc` 与 `pnpm test:live`（真实 opencode；默认免费模型 `opencode-go/deepseek-v4.1-flash`（D62），`AW_OC_TEST_MODEL` 可覆盖）、`pnpm perf`（性能实测）、`pnpm dist`（当前平台的未签名安装包）、`pnpm e2e:smoke`（Electron 启动冒烟）。三平台 CI 见 `.github/workflows/ci.yml` 与 `docs/17-cross-platform.md`；平台差异只在 `core/platform.ts` 等三处处理（D71）。
