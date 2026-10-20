# agent-workflow

本地桌面应用：选项目、选流程、写一句需求，AI（托管的 opencode 1.19.0）在独立 Git worktree 中完成开发，你查看结果并决定是否合并。默认简单，专业能力可选开启。

设计与规范见 [docs/](docs/README.md)。

## 开发环境

- macOS（arm64）、Node.js 24.19+、pnpm 10.28（`corepack enable`）、Git
- opencode 1.19.0（已登录至少一个模型提供方；开发与测试用免费模型 `opencode-go/beam-free`）

```bash
pnpm install
```

如需经代理下载 Electron：`NODE_USE_ENV_PROXY=1 pnpm install`（Node 24 才会读取 `HTTPS_PROXY`）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动桌面应用（开发模式，后端固定端口 47821，前端 47822） |
| `pnpm dev:server` / `pnpm dev:web` | 单独启动后端（Node 直接运行 TS）/ 浏览器前端 |
| `pnpm verify` | 提交前全量检查：类型、Biome、依赖边界、CSS 令牌、单元与集成测试、构建 |
| `pnpm e2e` | 浏览器模式 E2E |
| `pnpm e2e:electron` | Electron 模式 E2E（需先 `pnpm build`） |
| `pnpm dist` | 打包 macOS arm64 .dmg（未签名） |

## 许可

Apache-2.0，见 [LICENSE](LICENSE)。
