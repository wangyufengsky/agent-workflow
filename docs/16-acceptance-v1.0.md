# 16 · v1.0 验收报告

按 [01 §5](01-product.md#5-v10-验收标准) 的 9 条逐条验收（M6-06）。验收日期 2026-10-21，分支 `feat/M6-polish-release`，机器：macOS 26（Darwin 25.6，Apple 芯片），Git 2.45.2，opencode 1.19.0（已登录）。调用模型的测试先用 `opencode-go/beam-free`（D50）跑了一轮，之后默认模型改为 `opencode-go/deepseek-v4.1-flash`（D62）再跑一轮，两组结果都保留（见「live 结果：两种模型对比」）。

证据文件都在仓库根目录下**不提交**的 `screenshots/` 中（`.gitignore`），重新运行对应命令即可再生成：

| 目录 | 内容 |
| --- | --- |
| `screenshots/acceptance/` | 各命令的完整输出（最终一轮）：`verify.log`、`e2e.log`、`test-oc.log`、`e2e-electron.log`、`e2e-electron-dmg.log`、`dist.log`、`dmg-mount.log`（含 dmg 的 SHA-256）、`live-final.log`、`live-mcp-errors-rerun.log`、`perf.json`；`summary.txt` 为各命令的退出码。beam-free 一轮：`test-oc-beam-free.log`、`live-beam-free.log`；`e2e-repeat*.log` 为排查偶发失败时的重复运行 |
| `screenshots/walkthrough/<主题>/` | 四套主题 × 39 个页面状态的截图与 `report.json`（每页的对比度、溢出检查结果） |
| `screenshots/electron/` | 打包应用首次启动的引导页（`onboarding.png`）与结果卡（`result-card.png`） |
| `live/reports/` | live 测试报告（同样不提交）：每个任务的状态、尝试、提醒次数、tokens、`submit_*` 调用成败、模拟用户允许的每个权限请求及发起它的会话类型；`live/reports/beam-free/` 为 beam-free 一轮 |

结论速览：

| # | 验收标准 | 结果 |
| --- | --- | --- |
| 1 | 只装了 Git 与 opencode 的 Mac 上安装 dmg，首次引导全部通过 | **以替代方式通过**；真正的干净 Mac **需要用户完成** |
| 2 | 简单模式「新功能开发」无需中途操作到结果卡；合并后 squash 提交、worktree 清理 | 通过（见「已知差距」第 1 条：真实模型下仍偶有权限请求） |
| 3 | 同一项目 3 个任务并发、独立；都能合并，冲突交给 AI 解决 | 通过 |
| 4 | 提问、权限请求在「需要你处理」中回答后原会话继续 | 通过 |
| 5 | 执行中关闭应用，重开后继续（中断的尝试自动重试） | 通过 |
| 6 | 专业模式：编辑计划后执行、暂停调整、自定义流程跑通任务 | 通过 |
| 7 | MCP 工具返回错误码后模型据此修正并再次调用成功 | 通过 |
| 8 | 四套主题下全部页面无对比度问题、无横向溢出（1280 宽） | 自动检查通过；截图的人工走查**需要用户完成** |
| 9 | 测试规范要求的单元 / 集成 / E2E 测试全部通过 | 通过 |

另有一个**未解决的已知问题**：走查测试在一次完整 `pnpm e2e` 中偶发失败一次，根因未查明（见「未解决的已知问题」）。

## 1. 首次启动引导（干净 Mac）

**如何验证。** 本机无法提供一台「只装了 Git 与 opencode」的干净 Mac，改用最接近的替代：

1. `pnpm dist` 打出 `apps/desktop/release/Agent Workflow-1.0.0-arm64.dmg`（未签名，`dist.log`）。
2. `hdiutil attach -readonly` 挂载 dmg，把其中的 `Agent Workflow.app` 复制到一个临时目录（模拟拖进「应用程序」），卸载 dmg（`dmg-mount.log`）。
3. 用全新的用户数据目录（`--user-data-dir=<临时目录>`）启动复制出来的应用（最终一轮 dmg 的 SHA-256 为 `eb639d28…1883e`），跑 Electron 旅程 J10：`AW_E2E_EXECUTABLE=<副本>/Contents/MacOS/Agent\ Workflow pnpm e2e:electron`（`e2e-electron-dmg.log`）。J10 断言引导页三项检测（Git、opencode 1.19.0、可用的模型）都显示「已就绪」，然后添加项目、跑完一个任务（见第 2、5 条）。

**结果。** 通过：引导页三项全部就绪（`screenshots/electron/onboarding.png`），应用版本 1.0.0、图标为 `icon.icns`（Info.plist）。

**与验收标准的差距（如实说明）。**

- 本机除 Git 与 opencode 外还装有 Node、Docker、JDK 等；应用本身不依赖它们（安装包内没有 node_modules，D32），但这一点没有在真正干净的系统上验证过。
- 复制出的应用不带下载隔离标记（`com.apple.quarantine`），所以没有经过 Gatekeeper 对未签名应用的拦截。README「安装」一节写了首次打开时在「系统设置 → 隐私与安全性」中放行（或右键「打开」、`xattr -dr com.apple.quarantine`）的步骤，这一步**需要用户完成**：在另一台 Mac 上从网络下载 dmg、按 README 放行、确认引导页三项通过。
- 安装包未签名、未公证（本机没有 Developer ID 证书，`electron-builder.yml` 中 `identity: null`）。

## 2. 简单模式：新功能开发到结果卡，合并到 main

**如何验证。**

- 浏览器 E2E J1（`e2e/task.browser.spec.ts`，FakeOpencode 扮演 AI）：主页选项目 → 「新功能开发」→ 输入需求 → 开始，不做任何中途操作即出现结果卡，显示改动文件与「检查全部通过」。
- 浏览器 E2E J5（`e2e/task-delivery.browser.spec.ts`）：结果卡「合并到 main」→ 主分支多一个 squash 提交（提交说明为任务标题与编号），`git worktree list` 只剩主工作区，`aw/*` 分支已删除，任务为「已完成」。
- 真实模型：live 冒烟 `feature：新增 percentile`（`live/smoke.live.test.ts`，ts-stats 示例仓库）到达「待合并」，检查全部通过；J10 在打包应用中用真实模型跑「修 Bug」到结果卡（`screenshots/electron/result-card.png`）。

**结果。** FakeOpencode 下通过；真实模型下任务都能到达结果卡，但**仍可能出现少量权限请求**（`e2e.log`、`live-final.log`、`live/reports/smoke-*.json`）。

**备注。** live 中最初每个任务有 4–8 次权限请求，不满足「无需中途操作」。按根因修了两处：只读命令白名单缺 `echo`、版本查询等（D61），代码审查流程中只读角色执行的步骤没有放行项目检查命令（D51 扩展）；live 也改用推断出的检查命令。修复后 deepseek 一轮的冒烟（修 Bug、新功能）共 2 次请求，都是评审会话用 `node -e` 写内联脚本自行验证——这是模型自己的写法，不在任何只读白名单里，见「已知差距」第 1 条。

## 3. 同一项目 3 个任务并发

**如何验证。** 浏览器 E2E「三个任务同时运行改同一文件」（`e2e/task-delivery.browser.spec.ts`，M6-06 新增）：三个修 Bug 任务同时开始，每个都停在一个权限请求上（证明三者同时在执行、互不阻塞），`git worktree list` 中三条各自的 `aw/<任务编号>` 分支与工作区；依次合并：第一个直接合并，第二、三个合并冲突 → 「交给 AI 解决冲突」→ 再合并成功，最终 main 上的文件包含三方的改动，工作区全部清理。另有：集成测试并发创建 5 个任务的 worktree（M3-02）；`pnpm perf` 中 10 个任务在同一项目并发运行全部到达待合并（`perf.json` 的 `concurrent10`）。

**结果。** 通过。

## 4. 提问与权限请求

**如何验证。** 浏览器 E2E J2（阻塞提问 → 在「需要你处理」中作答 → 原会话继续 → 完成）、J3（权限请求 → 允许一次 → 继续）；集成测试覆盖 12 §6.7 `ask_user` 的每个分支与回答回传同一会话（`modules/inbox`、`modules/tasks`）。真实模型下，live 与 J10 的「模拟用户」经同一接口允许权限请求后任务继续完成（`live/reports/*.json` 的 `userActions`）。

**结果。** 通过。

## 5. 执行中关闭应用，重开后继续

**如何验证。** Electron 旅程 J10（`e2e/journey.electron.spec.ts`，打包应用、真实 opencode 与模型）：第一个步骤显示「进行中」时关闭应用，用同一用户数据目录重新启动，任务继续执行到结果卡；断言该步骤的尝试中有一次 `interrupted`（被打断的尝试）且步骤重新执行。集成测试 `tasks.recovery.int.test.ts` 覆盖重启恢复的各情形（M3-09）。

**结果。** 通过：未打包应用（`e2e-electron.log`）与 dmg 副本（`e2e-electron-dmg.log`）各跑一次。

## 6. 专业模式

**如何验证。** 浏览器 E2E J7（开启「运行前让我确认计划」→ 编辑计划：加步骤、连依赖 → 确认 → 按新计划执行完成）、「步骤操作冒烟」（暂停 → 跳过步骤 → 中止会话 → 继续执行）、J8（复制内置流程 → 修改 → 用它跑通任务）；集成测试 M5-02（暂停后只能改未开始的节点，编辑已开始节点 409 `NODE_NOT_EDITABLE`，确认后重新物化）。

**结果。** 通过。

## 7. MCP 错误码让模型自我修正

**如何验证。** 真实模型 live 测试 `live/mcp-errors.live.test.ts`（M6-06 新增）：需求要求规划者第一次 `submit_plan` 时用不存在的角色，断言会话记录中先有返回 `PLAN_INVALID` 的调用、之后有一次被接受的 `submit_plan`，任务到达「待确认计划」。另有集成测试 M3-04（非法计划返回 `PLAN_INVALID`，FakeOpencode 按 hint 修正后通过）与 M0 的 S3 实测（D38）。

**结果。** 通过：beam-free 与 deepseek-v4.1-flash 各自的运行中，模型都在收到 `PLAN_INVALID` 后改正并提交成功（`live-beam-free.log`、`live-mcp-errors-rerun.log`）。deepseek 一轮的 `live-final.log` 中该用例曾失败一次，根因是测试本身：任务状态在提交调用内部就已改变，而调用结果要等调用返回才写入会话记录，测试在状态事件上就去读记录；改为等任务的所有尝试结束再读后，重跑通过（提交 `test(live): read transcripts only after…`）。

## 8. 四套主题、全部页面无对比度与横向溢出问题

**如何验证。** 浏览器 E2E J9 走查（`e2e/walkthrough.browser.spec.ts`，M6-01）：1280×800 下，四套主题 × 两种模式共 39 个页面状态（引导页、主页、⌘K、任务列表、任务页的执行中 / 提问 / 待确认计划 / 失败 / 待合并 / 已完成、步骤抽屉与完整步骤页、改动抽屉、需要你处理浮层与页面、项目、设置、专业页面全部、Git 管理台四个页签、流程编排器、计划编辑画布等），每页：

- 无 `ErrorState`、无未捕获异常；
- axe-core `color-contrast` 规则无违规（WCAG AA：正文 4.5:1、大字 3:1；禁用控件豁免）；检查时临时去掉装饰性背景渐变，渐变最浓处的对比度由主题单测覆盖；
- 无横向溢出：页面不横向滚动，没有元素越出视口，除代码、diff、会话流与画布外没有横向滚动的容器。

走查找出并已修复：DeepSeek 主题品牌按钮白字对比度 4.33:1；`muted` 文字在悬停 / 选中底色与侧栏上低于 4.5:1（四套主题）。主题单测因此扩大到这些底色（14 §4）。

完整 `pnpm e2e` 运行中又发现一处：GitHub 白主题侧栏「任务」旁的数量徽标（`stall` 文字叠在侧栏选中项上）为 3.65:1；只在徽标显示两位数时被 axe 检查到（一位数时 axe 判定内容太短而跳过），单测因此加上徽标的底色，`stall` 改深。

**结果。** 自动检查四套主题全部通过（`e2e.log`、`screenshots/walkthrough/*/report.json`）；偶发失败见「未解决的已知问题」。截图已抽查约 30 张并修正了发现的问题（设置页开关错位、需要你处理页标题、日期格式、空的操作面板、日志行数标签换行、MCP 工具英文说明）；**逐张人工走查需要用户完成**：查看 `screenshots/walkthrough/<主题>/*.png`（共 156 张）。

## 9. 测试全部通过

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm verify`（类型、Biome、依赖边界、CSS 令牌、状态机文档、单元、集成含 Docker MySQL、构建与生产包检查） | 通过：单元 163、集成 153 | `verify.log` |
| `pnpm e2e`（浏览器 J1–J9、三任务并发与冒烟） | 通过：19 个（偶发失败一次见「未解决的已知问题」） | `e2e.log`、`e2e-repeat*.log` |
| `pnpm e2e:electron`（J10，未打包应用与 dmg 副本各一次） | 通过 | `e2e-electron.log`、`e2e-electron-dmg.log` |
| `pnpm test:oc`（默认配置，真实 opencode） | 通过（beam-free 与 deepseek-v4.1-flash 各一次） | `test-oc-beam-free.log`、`test-oc.log` |
| `pnpm test:live`（五个内置流程、Java/Maven 示例、MCP 纠错、只读规则） | 通过（beam-free 一轮全过；deepseek 一轮中 MCP 纠错用例因测试竞态失败一次，修复后重跑通过）；托管平台的真实令牌用例跳过（见下） | `live-beam-free.log`、`live-final.log`、`live-mcp-errors-rerun.log`、`live/reports/` |

## 需要用户完成的项

1. **干净 Mac 安装**（第 1 条）：在另一台只装 Git 与 opencode 1.19.0（已登录）的 Mac 上，从网络下载 dmg、按 README 在「隐私与安全性」中放行，确认引导页三项通过。
2. **截图人工走查**（第 8 条）：`screenshots/walkthrough/` 四套主题各 39 张。
3. **托管平台真实令牌**（第 2 条的「创建 PR」路径，07 §6）：本机没有令牌，`live/hosting.live.test.ts` 中验证真实令牌与创建 PR 的两个用例被跳过（无效令牌返回 `HOSTING_AUTH_FAILED` 的用例在 github.com 与 gitlab.com 已通过）。设置 `AW_LIVE_HOSTING_PROVIDER`、`AW_LIVE_HOSTING_REPO`、`AW_LIVE_HOSTING_TOKEN`（及 `AW_LIVE_HOSTING_PR_HEAD` / `AW_LIVE_HOSTING_PR_BASE`）后运行 `pnpm test:live`。
4. **签名与公证**：有 Developer ID 证书后在 `electron-builder.yml` 中配置。
5. **打 tag 与发布 GitHub Release**：留给用户确认。

## 性能（M6-02）

`pnpm perf`（生产构建的前端，FakeOpencode 后端，无 GPU 的 headless Chromium，1280×800），`perf.json`：

| 项目 | 目标 | 修复前 | 结果 |
| --- | --- | --- | --- |
| 20 节点计划画布：只读画布平移 / 缩放，编辑画布平移 / 缩放 / 拖动步骤 | > 50 fps | — | 59.3–60 fps，无长任务（> 50 ms） |
| 5 MB 会话流（约 6000 行）首屏 | < 300 ms | 1215 ms | 52 ms；首页接口 24 ms，其余 30 页在后台读完 0.6 s，期间滚动 60 fps |
| 10 个并发任务：主页 / 打开实时会话流的任务页 | 无卡顿 | 任务页 48.6 fps | 主页 60 fps；任务页 54.2 fps，无长任务；接口 p50 33 ms、最大 63 ms |

会话流的根因与修复见 10 §3 与提交 `perf(attempts)`：每页都重新解析整个 JSONL、前端等全部页读完才显示、每来一行都重新解析所有 Markdown。

## live 结果：两种模型对比

每格为「状态 · 耗时（分钟）· 尝试次数 · tokens」；全部任务都到达预期状态，`submit_*` 均在 1 次内被接受（MCP 纠错用例除外，它故意先失败一次）。beam-free 取 D61 之后的一轮（`live/reports/beam-free/*16-1[24]*`），deepseek 取最终一轮（`live/reports/*17-0*`、`*16-55*`）。

| 用例 | beam-free | deepseek-v4.1-flash |
| --- | --- | --- |
| 修 Bug（TS） | 待合并 · 0.6 · 3 · 7.8 万 | 待合并 · 1.4 · 3 · 4.0 万 |
| 新功能（TS） | 待合并 · 1.4 · 5 · 11.9 万 | 待合并 · 3.1 · 5 · 9.9 万 |
| 修 Bug（Java / Maven） | 待合并 · 0.9 · 3 · 10.0 万 | 待合并 · 2.1 · 3 · 4.0 万 |
| 补单测（TS） | 待合并 · 0.4 · 3 · 7.5 万 | 待合并 · 1.6 · 3 · 3.6 万 |
| 代码审查（Java） | 待合并 · 0.5 · 1 · 1.5 万 | 待合并 · 0.7 · 1 · 3.0 万 |
| 重构（Java / Maven） | 待合并 · 2.1 · 5 · 11.4 万 | 待合并 · 5.0 · 6 · 8.7 万 |
| MCP 纠错（规划） | 待确认计划 · 0.2 · 1 | 待确认计划 · 0.4 · 1 |
| 权限请求（模拟用户允许） | 冒烟 3 · 全集 4 | 冒烟 2 · 全集 3 |
| opencode 记录的成本（全部 7 个任务） | $0 | 约 $0.069（每个任务 $0.003–0.020） |

deepseek-v4.1-flash 在多数用例中用的 tokens 更少（代码审查除外），耗时约为 beam-free 的两到三倍；重构多了一次执行尝试。两个模型都没有触发提醒（nudge）。注意：opencode 为 deepseek-v4.1-flash 的会话记了少量成本（上表），beam-free 为 0；按用户说明该模型在 opencode go 订阅内免费，是否实际计费以订阅账单为准，本报告无法确认。

## 未解决的已知问题

**走查测试偶发失败一次（根因未查明）。** 最终验收前的一次完整 `pnpm e2e` 中，`walkthrough.browser.spec.ts` 在 GitHub 白主题、专业模式打开 `/git/:projectId?tab=commits` 时失败：`expect(html).toHaveAttribute('data-theme', 'github_white')` 等待 5 秒，`<html>` 始终没有 `data-theme`。其余 18 个测试通过。

- 失败的含义：`data-theme` 由根路由组件 `Root` 的 effect 设置，而 `Root` 只在根路由的 loader（`GET /settings`）完成后渲染；loader 失败时根路由的 `errorComponent` 渲染且不应用主题。所以这 5 秒里要么 `GET /settings` 没有完成，要么它失败了。
- 已排查：同一次运行的服务日志（日志级别 warn）没有后端错误（5xx 会以 error 级别带堆栈记录），也没有 Vite 代理错误（`http proxy error`）与依赖重新预构建（`new dependencies optimized`）；同一时刻 Vite 记录的 `ResizeObserver loop completed with undelivered notifications` 只是 `@vite/client` 转发的 window 错误，在通过的运行中也出现，与失败无关。之后在同一台机器上重复了 14 次（完整 `pnpm e2e` 4 次——其中 3 次与 live 测试同时运行以加压，走查单独 `--repeat-each=6` 一次又 4 次单跑），共约 2200 次页面加载，均未复现。
- 为什么无法确定：那次运行的 Playwright trace 已在后续运行中被清理，完整日志被我误覆盖，现有证据只能把范围缩小到「`/settings` 请求未完成或失败」，区分不出是浏览器连接、Vite 开发服务器还是后端的问题。
- 已做：浏览器 E2E 现在失败时保留 trace（网络、控制台、DOM 快照，`playwright.config.ts`），走查的数据准备可在同一后端上重复运行（`--repeat-each`）。再次出现时用 `npx playwright show-trace test-results/<用例>/trace.zip` 查看 `/api/v1/settings` 请求即可定位。
- 该问题出现在开发服务器（Vite dev）下的浏览器 E2E；打包应用（J10）不经过 Vite，未观察到。

## 已知差距与发现但未处理

1. **真实模型下的权限请求**：修复后每个任务仍有 0–2 次权限请求，来源是只读会话（规划、评审、代码审查步骤）里模型自己写的命令不在白名单：`node -e '…'` 内联脚本、`mvn test`（与推断的检查命令 `mvn -q test` 不同）、`npx tsc --version`。白名单不可能覆盖模型的所有写法，放得更宽又会削弱「只读」；是否调整由用户决定。（早先报告里「执行会话」请求 `mvn` 权限的情况已查明：那是代码审查流程中由只读评审者角色执行的步骤，已修复。）
2. 主题单测与 axe 都不检查画布节点内的文字（axe 判定为被 React Flow 图层覆盖、无法确定背景）；节点文字使用状态语气色，已在「状态文字在自身填充色上 ≥ 4.5:1」中覆盖令牌。
3. 前端主包 5.2 MB（shiki 语法按需加载但 cpp 等大语法单独成块），本地加载不受网络影响，未优化。
4. **已修复**（D63）：只读白名单按前缀匹配，`find … -exec` / `-delete`、重定向（`cat a > b`）、`rg --pre`、`git log --output`、`git grep -O` 等会被当作只读放行，规划者与评审者能借此写文件或执行程序。现在这些写法在白名单之后改回询问；单测 `shared/constants/opencode.test.ts` 先证明了漏洞（16 种写法 × 两套预设全部被放行）再验证修复，live `permissions.live.test.ts` 在真实 opencode 上确认三种逃逸写法询问、对应的只读写法不询问（`live-permissions.log`）。代价：只读会话中 `2>/dev/null` 这类重定向也会询问。
