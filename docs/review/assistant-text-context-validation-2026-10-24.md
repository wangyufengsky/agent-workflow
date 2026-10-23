# AP-02 显式文字上下文验证 · 2026-10-24

任务、步骤与用户选取/粘贴的文字通过显式按钮生成不可变文本附件，带来源、采集时间和资料边界；用户可预览、编辑选区、移除，再与文件一同发送。任务字段采用明确允许清单，排除凭据、绝对路径、原始错误 details；限长并说明截断。主页、侧栏与桌宠复用附件组件与现有归属校验。

评审覆盖后端来源/步骤归属校验、发送绑定、资料边界、UI 的草稿和在途移除。生成中的附件被移除后，迟到响应不重新打开预览或进入消息；该竞态先通过受控响应复现，再修复。

在 AP-01 已合并的 main f540ceb 上重放分支，保留 taskRelay 与 snapshot 两项注册和文档，完成以下验证：

- 完整 check 通过。
- 全量 unit：712/712 通过。
- 全量 int：336 通过，1 条既有 SQL Server 不适用场景跳过（主键 INCLUDE 列）；57 个测试文件通过。
- 生产 build 与 bundle 检查通过。
- 聚焦浏览器 E2E：3/3 通过，涵盖任务详情与文件共存、主页选区编辑、开始任务模式隐藏入口、在途移除。
- 定向助手/附件组合：10 文件 69 项通过；明暗界面截图已审阅。

原始本机日志：/private/tmp/aw-assistant-context-check.log、aw-assistant-context-unit.log、aw-assistant-context-full-int.log、aw-assistant-context-build.log、aw-assistant-context-e2e.log。未增加数据库迁移，没有触碰 Claude 工作区。GitHub CI 为手动触发，本记录只报告本机 macOS 验证。
