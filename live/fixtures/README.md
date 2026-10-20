# live 测试示例仓库

`pnpm test:live` 把这里的项目复制到临时目录、初始化为 Git 仓库后交给真实的 opencode 与模型（07 §6）。

| 项目 | 内容 | 已知缺陷 | 功能需求 |
| --- | --- | --- | --- |
| `ts-stats` | TypeScript 统计函数，检查命令 `node --test`（Node 内置测试，无需安装依赖） | `median` 用默认的字符串排序，`median([10, 9, 1])` 返回 10 而不是 9 | 新增 `percentile(values, p)` |
