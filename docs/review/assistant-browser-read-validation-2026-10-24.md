# AP-03a 助手只读网址与预览操作验证 · 2026-10-24

助手增加 browser.readUrl，输入限定 HTTP(S) 且不含凭据；沿用用户网站允许列表与登录分区，但每次读取强制只读，禁止写请求和 WebSocket，读取后关闭临时页。页面文字、标题、地址、控制台/请求错误作为资料返回。预览 get 可直接查询，start/stop 通过既有 write 确认，不自动试运行或登录。

独立评审复现并修复两个边界：

- 开发 Chromium 的页面拦截看不到 SharedWorker 的 POST。现在共享 Worker 在执行前暂停并关闭；Electron 的未归属请求拒绝并记录。无法可靠归属共享 Worker，因此不继承任一用户页的权限，这项限制已写入文档。
- Page.navigate / 初始化 CDP 不回应时，原 settle 截止无法生效。现在整个读取使用注入 Clock 的 30 秒截止，返回 BROWSER_READ_FAILED(reason=timeout)，关闭临时页、取消等待和计时器；迟到的打开回包交付即清理。

回归证据：两项先失败后通过；浏览器单元/集成 5 文件 29 项通过，真实 Electron host 4/4 通过（包括 SharedWorker）。应用工具/MCP 与页面策略的已有检查保持通过。原生用户预览界面及无参数 browser_read 由独立 AP-03b 交付，本 PR 不冒称已提供。

基于 AP-02 main 559d6c0 的完整 check 已通过；全量单元 713/713。全量集成 344 通过、1 条既有 SQL Server 条件跳过（59 文件）；生产 build 与 bundle 检查通过。原始日志位于 /private/tmp/aw-assistant-browser-check.log、aw-assistant-browser-unit.log、aw-assistant-browser-full-int.log、aw-assistant-browser-build.log。没有数据库迁移，未修改 Claude 工作区。GitHub CI 为手动触发，本次只报告本机 macOS 验证。
