# live 测试示例仓库

`pnpm test:live` 把这里的项目复制到临时目录、初始化为 Git 仓库后交给真实的 opencode 与模型（07 §6）。`smoke.live.test.ts`（修 Bug、新功能）与 `workflows.live.test.ts`（Java 修 Bug、补单测、代码审查、重构）合起来让五个内置流程各跑一次，报告写到 `live/reports/`。

| 项目 | 内容 | 已知缺陷 | 功能需求 |
| --- | --- | --- | --- |
| `ts-stats` | TypeScript 统计函数，检查命令推断为 `npm test`（即 `node --test`，Node 内置测试，无需安装依赖） | `median` 用默认的字符串排序，`median([10, 9, 1])` 返回 10 而不是 9 | 新增 `percentile(values, p)` |
| `todo-web` | 待办页面：零依赖的 Node 静态服务器（`npm run dev` 读 `PORT`），页面逻辑在 `public/`，`node --test` 测 `addTodo`；推断出的预览为 `npm run dev`、安装命令 `npm ci`（空的 package-lock） | — | 加「清空」按钮并在页面预览里验证（`browser.live.test.ts`，29 §13） |
| `java-inventory` | Java 17 库存类（Maven + JUnit 5），检查命令推断为 `mvn -q test`（首次运行需从 Maven 中央仓库下载 JUnit 与 surefire） | `lowStock(threshold)` 用 `<`，库存正好等于阈值的商品没有列出 | 提取 `add` / `remove` 中重复的数量校验（重构）；审查 `Inventory`（代码审查） |
