# agent-workflow · AI 编码助手须知

当前阶段：**v1.4.0 已发布**（2026-10-26，内网部署适配，D161–D186，05 的 IN 系列，见 `docs/04-project-plan.md` §5.2e；macOS arm64 与 Linux x64 / arm64，未签名；Windows 暂缓，D160）。此前：**v1.3.0 已发布**（2026-10-25）；**v1.2 开发完成**（v1.1：应用助手、知识问答、Windows / Linux、质量与用量、批量任务；v1.2：PR 审查意见回流、定时任务、PPT、更多数据库，见 `docs/04-project-plan.md` §5），待用户检查后发布。v1.3 内置浏览器与页面预览（`docs/29-browser.md`，D120–D125）的 B1 已合并（05 的 B-01…B-08），B2 已合并（05 的 B2-01…B2-08），B3 已合并（05 的 B3-01…B3-04）。团队页（`docs/33-team.md`，D128–D131，05 的 T 系列）已实现，待用户检查。没有 Git 的项目在添加时初始化 Git（D153，05 的 G-01）已实现，待用户检查。全局 GitHub / GitLab 令牌（D155，05 的 H-01）已实现，待用户检查。Linux 凭据存储（识别不了的桌面环境改用 libsecret、没有密钥服务时的主密码，D167，05 的 IN-07）已实现，待用户检查。内网网络一致性（`NO_PROXY` 网段经后端的转发代理、git 与内置浏览器用设置里的 CA 与代理，D174–D176，05 的 IN-14…IN-16）已实现，待用户检查。v1.0 验收报告见 `docs/16-acceptance-v1.0.md`。开始任何开发任务前，先读：

1. `docs/06-coding-standards.md`：找根因不兜底、不过度防御、状态只经状态机、一处定义。
2. `docs/07-testing-standards.md`：测行为不测实现、少而有效、真实 SQLite/Git、缺陷先写失败测试、禁止 sleep。
3. `docs/05-dev-plan.md` 中你所做任务的条目，以及它引用的文档章节。

权威来源：枚举与错误码 `docs/08`，状态机 `docs/09`，表结构 `docs/10`，API `docs/11`，MCP 工具 `docs/12`。改动这些内容时同一提交更新文档。

`opencode-workflow-design-showcase/` 只是视觉参考，与 `docs/14-ui-spec.md` 冲突时以后者为准。

文档、注释与界面文案用中文；代码标识符、日志消息、提交信息用英文。

常用命令：`pnpm dev`（桌面开发；端口 47821 / 47822 被别的 worktree 占用时用 `AW_DEV_API_PORT` / `AW_DEV_WEB_PORT` 换一组）、`pnpm verify`（提交前全量检查：类型、lint、依赖边界、单元与集成测试、构建；数据库集成测试需要本机 Docker 与 `mysql:8.4` 镜像）、`pnpm e2e`（含四主题走查，截图在 `screenshots/walkthrough/`；后端用系统分配的端口，多个 worktree 可同时运行，D78）、`pnpm e2e:electron`（需先 `pnpm build`；真实 opencode 与模型）、`pnpm test:oc` 与 `pnpm test:live`（真实 opencode；默认免费模型 `opencode-go/deepseek-v4.1-flash`（D62），`AW_OC_TEST_MODEL` 可覆盖）、`pnpm perf`（性能实测）、`pnpm dist`（当前平台的未签名安装包）、`pnpm e2e:smoke`（Electron 启动冒烟）。CI（Linux x64 / arm64 与 macOS，手动触发；Windows 暂缓，D160）见 `.github/workflows/ci.yml` 与 `docs/17-cross-platform.md`；平台差异只在 `core/platform.ts` 等三处处理（D71）。
