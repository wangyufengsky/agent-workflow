# 07 · 测试规范

## 1. 原则

1. **测试行为，不测实现。** 断言外部可观察的结果（返回值、状态、写入的数据、发出的事件、文件系统与 Git 状态），不断言内部调用次数和私有函数。
2. **少而有效。** 一个行为在最合适的一层测一次。不为凑覆盖率写测试，不在三层重复测同一件事。
3. **真实依赖优先。** SQLite、Git、文件系统用真的（临时目录）；只有 AI（opencode/模型）和第三方 HTTP API（GitHub/GitLab）用假实现。
4. **缺陷先写失败的测试。** 修复缺陷时先写能复现根因的测试（修复前失败），再修代码。
5. **稳定是硬要求。** 不允许 sleep 等待、不允许测试重试；出现不稳定的测试按缺陷处理，找根因。

## 2. 测试分层

| 层 | 工具 | 对象 | 依赖 | 位置 | 命令 |
| --- | --- | --- | --- | --- | --- |
| 单元 | Vitest | 纯逻辑：状态机表、计划校验、调度决策函数、git 输出解析器、配置生成、检查点解析、错误映射、主题对比度 | 无 IO | 被测文件旁 `*.test.ts` | `pnpm test` |
| 集成 | Vitest | 模块 service 与 HTTP/MCP 接口：从 API 或 MCP 调用到数据库与 Git 结果 | 真实 SQLite（临时文件）、真实 git（临时仓库）、FakeOpencode、假 Hosting 服务 | `*.int.test.ts` | `pnpm test:int` |
| opencode 集成 | Vitest，标记 `@opencode` | runtime 托管、配置注入、插件、事件解析 | 本机真实 opencode 1.19.0，**不调用模型**（只启动、读配置、建会话、发 `noReply` 消息）；唯一例外是 bridge 插件测试（只有模型能让 opencode 调用工具），用免费模型（D42） | `*.oc.test.ts` | `pnpm test:oc`（先构建插件） |
| E2E | Playwright | 关键用户旅程（§5） | 浏览器模式：后端 + FakeOpencode；Electron 模式：打包产物 | `e2e/` | `pnpm e2e` / `pnpm e2e:electron` |
| live | Vitest，标记 `@live` | 真实模型跑内置流程 | 真实 opencode + 模型 + 示例仓库 | `live/` | `pnpm test:live`（手动，不进 CI） |

## 3. 每一层测什么、不测什么

### 3.1 必须测

- 每张状态机转换表：每个合法转换至少一次、代表性的非法转换。
- `validatePlanGraph` 每个问题子码。
- 调度决策：并发上限、依赖、失败后停止派发、推导任务事件。
- 每个 API 端点：一个成功路径 + 该端点特有的错误码（不重复测通用的 401/400 机制，那由 core 的测试负责一次）。
- 每个 MCP 工具：一个成功路径 + 工具特有的错误码 + 允许的尝试类型限制。
- 每个 opencode 结束条件（12 §4.2）。
- Git 相关：worktree 创建/删除、三种合并策略、冲突、主工作区保护、并发。
- 每个修复过的缺陷：一个回归测试。

### 3.2 不要测

- 框架与库的行为（zod 能否校验、React 能否渲染、Drizzle 能否插入）。
- 仅做转发的薄层（route → service 的透传本身；它们由集成测试经接口覆盖）。
- getter、类型定义、常量值本身。
- 同一逻辑在单元、集成、E2E 各测一遍。
- 整页 DOM 快照、像素对比（截图只用于人工走查，不做断言）。
- 「调用了某 mock 几次」这种实现细节（除非调用本身就是外部可观察的行为，如「向 opencode 发送了答案消息」，此时断言 FakeOpencode 收到的内容）。
- 为不可能的输入写的测试（类型系统已排除的情况）。

### 3.3 快照

只允许用于「输出本身就是产物」的场景：生成的 opencode 配置对象、生成的状态机 Mermaid、提示词模板渲染结果。快照文件须评审。

## 4. 假实现与测试工具

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `FakeOpencode` | `packages/server/test/fakes/fake-opencode.ts` | 实现 `OpencodeClient` 接口；`fake.enqueue(script()…, match?)` 为之后发给会话的消息排一个回合（`match` 按会话标题、agent、目录的子串选会话，第一个匹配的脚本生效）：`edit(file, content)`、`text(…)`、`callTool(name, args)`、`ask(...)`、`requestPermission(...)`、`hang()`（一直工作直到被中止）、`error(...)`，回合结束即空闲（没有排脚本的消息直接空闲）；真实写 worktree 文件、真实通过 MCP 调用后端（注入 `__aw_session`）。可断言 `sessions`、`prompts`、`toolCalls`、`aborts`、`permissionReplies`；`crash()` 模拟运行时消失；`settled()` 等待已开始的回合放完。浏览器 E2E 中后端以 `AW_FAKE_OPENCODE=1`（仅开发模式）使用它，spec 经开发接口 `POST /api/v1/dev/fake-opencode/scripts` 排回合（按项目的 worktree 目录匹配，互不干扰）；`createTestApp({ dataDir, fake })` 复用同一个 FakeOpencode 模拟后端重启 |
| `FakeHosting` | `test/fakes/fake-hosting.ts` | 本地 HTTP 服务模拟 GitHub/GitLab 用到的少数端点 |
| `createTestRepo()` | `test/helpers/git.ts` | 在临时目录建 Git 仓库，带初始提交，可选远端（本地 bare 仓库） |
| `createTestApp()` | `test/helpers/app.ts` | 启动后端（临时数据目录、随机端口），返回类型化 API 调用 `call(op, input)`、`mcpUrl`、FakeOpencode；`realOpencode: true` 用于 `@opencode` 测试；MCP SDK 客户端见 `test/helpers/mcp.ts` |
| `build.*()` | `test/builders/` | 最小测试数据构造器，只填测试关心的字段，其余用合法默认值 |
| `waitForEvent(type, predicate)` | `test/helpers/events.ts` | 订阅 event-bus 等待事件，带超时（默认 5s）；**替代一切 sleep** |
| `FakeClock` | `test/helpers/clock.ts` | 注入时钟，测试超时与 nudge 逻辑，不真实等待 |

后端代码中需要时间的地方（超时、时间戳）通过注入的 `clock` 获取，不直接调 `Date.now()` / `setTimeout`，以便测试控制。

## 5. E2E 旅程（只做这些）

| # | 旅程 | 模式 |
| --- | --- | --- |
| J1 | 简单模式：选项目 → 新功能流程 → 输入需求 → 开始 → 结果卡显示改动与检查通过 | 浏览器 |
| J2 | AI 阻塞提问 → 需要你处理中作答 → 节点继续 → 完成 | 浏览器 |
| J3 | 权限请求 → 允许一次 → 继续 | 浏览器 |
| J4 | 检查命令失败 → 自动重试成功；另一节点预算耗尽 → 任务失败 → 用户重试 → 完成 | 浏览器 |
| J5 | 合并到 main（squash）→ 主分支有提交、worktree 已清理、任务已完成 | 浏览器 |
| J6 | 两个任务改同一文件 → 第二个合并冲突 → 交给 AI 解决 → 合并成功 | 浏览器 |
| J7 | 专业模式：开启确认计划 → 编辑计划（加节点、连线）→ 确认 → 按新计划执行 | 浏览器 |
| J8 | 专业模式：复制内置流程 → 修改 → 用它跑通一个任务 | 浏览器 |
| J9 | 四主题与两种模式切换，主要页面可打开无报错 | 浏览器 |
| J10 | 打包应用：引导页 → 添加项目 → J1 精简版；运行中退出重开 → 任务继续完成 | Electron |

E2E 使用页面上的可访问名称与 `data-testid`（仅在无合适可访问名称时）定位，不用 CSS 类名。

## 6. live 测试

- 示例仓库：`live/fixtures/` 下的小项目，各带一个已知缺陷和一个功能需求：`ts-stats`（TypeScript + `node --test`，M3-12）；Java + Maven 随 M6-05。说明见 `live/fixtures/README.md`。
- M3-12 冒烟 `live/smoke.live.test.ts`：`bugfix` 与 `feature` 各跑一次，报告写到 `live/reports/smoke-<时间>.json`（尝试、提醒次数、用量、`submit_*` 调用成败）。
- 用例：五个内置流程各一次；统计 `submit_*` 调用成功率、尝试次数、耗时、成本，输出报告到 `live/reports/`。
- 不作为通过/失败的硬门槛（模型有随机性），但内置提示词改动的 PR 必须附 live 报告对比。

## 7. 编写规则

- 测试名描述行为：`it('拒绝包含环的计划并返回 CYCLE')`，中文英文均可，同一文件保持一致。
- 结构 Arrange / Act / Assert，一个测试验证一个行为；可以有多个相关断言。
- 测试之间不共享可变状态；每个集成测试用独立临时目录与数据库。
- 断言具体值，不用「不为空」「被调用过」这类弱断言代替。
- 错误断言断言错误码：`await expect(p).rejects.toMatchObject({ code: ErrorCode.PlanInvalid })`。
- 测试代码同样遵守 06 规范（除允许 `as` 构造数据）。

## 8. 覆盖率与门槛

- 不设全局覆盖率百分比。
- 以下模块要求分支覆盖率 ≥ 90%：`shared/fsm`、`shared/workflow`（计划校验）、`scheduler`、`mcp.registry`。
- CI（本地 `pnpm verify`）：check + test + test:int + e2e（浏览器）必须全绿；`test:oc` 在装有 opencode 的机器上随 `pnpm verify:full` 执行。
- 测试失败时禁止 `.skip` 合并；确需暂时跳过须附任务编号与原因，并在一周内处理。
