# AP-03b 用户预览与助手只读验证记录

日期：2026-10-24。开发分支：`codex/assistant-user-preview`，独立工作区 `assistant-user-preview`。本切片起初基于 AP-03a 的 `7498237`，后仅重放本切片两个提交到含 AP-04 的 `origin/main`（`0ccb735`），保留 AP-02 正文附件/快照契约和 AP-04 对话服务调用目录。AP-05 是另一独立切片。

## 交付边界

- Electron 任务页提供「进度 / 预览」与真实用户预览页签。用户显式打开后，界面将当前页签关联到当前助手对话。
- `browser_read` 仅接受空参数，读取明确关联的用户页；不猜测最近任务、不读取 AI 页签。新增打开、导航、视口与关联操作仅供界面调用。
- 离开任务路由/预览页签或切换对话时解除旧关联；助手浮层、命令面板及模态框只隐藏原生视图，保留当前预览关联。停止/重启预览不自动恢复旧关联。
- 发送等待关联时一旦切换页面或对话，该消息取消并保留草稿；完整发送请求不占用关联更新的串行范围。
- 原生视图限制在窗口和各滚动容器的可见交集，完全离屏时隐藏。普通浏览器显示桌面版提示。
- 读取及导航整体截止为 30 秒。超时不关闭已有用户页或解除关联；初次创建失败清理新页，退出主动取消浏览器等待。
- 本期没有助手点击/输入、截图/PDF/视觉输入、AI 观看画面或预览启动后自动跳转。
- 此处仅实现明确用户页与助手文字读取所需的最小依赖，不代表完整 B2 完成。Claude 的 `feat/B2-browser` / PR #63 包含完整 B2 页面体检、AI 画面等工作，仍由其独立分支另行集成；后续合并需统一重名 browser 接口。本分支未修改该分支或其工作区。

## 回归与验证

| 检查 | 结果与证据 |
| --- | --- |
| 修复前读取超时 | 在 `b085b13` 上应用新增受控 CDP 回归：FakeClock 前进 30 秒后读取仍不返回，测试失败；日志 `/private/tmp/aw-user-preview-deadline-red.log` |
| 修复前并发打开 | 第二次同任务打开提前返回尚未导航完成的页签，断言本应共同失败却收到成功；日志 `/private/tmp/aw-user-preview-concurrent-red.log` |
| Chromium 浏览器整组 | 5 文件、30 用例通过，含只读网站/SharedWorker、临时页清理、用户归属、旧关联失效、超时后恢复、并发打开与退出；命令 `pnpm exec vitest run --project int packages/server/src/modules/browser --maxWorkers=1`；日志 `/private/tmp/aw-user-preview-review-browser-all.log` |
| 真实桌面与普通浏览器 | 2 用例通过，真实 Electron 11.8 秒、总计 19.2 秒；真实原生 view、快捷键焦点、助手读取、隐藏/恢复、外部重启、路由解绑、PUT 回应屏障下取消消息和保留草稿、缩窗滚动的 native bounds 裁切；日志 `/private/tmp/aw-user-preview-review-ui.log` |
| 最新主线静态与构建 | 基于 `0ccb735`，`pnpm check`、`pnpm build` 与生产包边界检查全部通过；日志 `/private/tmp/aw-user-preview-integrated-check.log`、`/private/tmp/aw-user-preview-integrated-build.log` |
| 最新主线全量验证 | 719 单测通过；62 文件、357 集成用例通过、1 项既有环境跳过（126.10 秒，`--maxWorkers=2`）；日志 `/private/tmp/aw-user-preview-integrated-unit.log`、`/private/tmp/aw-user-preview-integrated-int.log` |
| 最新主线集成界面 | 5 E2E 通过（19.5 秒）：AP-02 的任务详情快照与附加文件、主页选中文字、快照移除后的迟到回应 3 项，以及用户预览的普通浏览器/真实 Electron 2 项；消息请求断言保留完整 `attachmentIds`。日志 `/private/tmp/aw-user-preview-integrated-ui.log` |
| 视觉走查 | 四主题截图与真实原生 WebContents 单独截图存于本地忽略目录 `screenshots/user-preview-*.png`。renderer 截图不包含原生子视图，因此额外检查 native 图像，真实页显示「只有用户预览的内容」 |

## Chromium 156 关闭竞态

测试实际运行的 Chromium 为 **156.0.8078.4**。旧实现收到首次 `Page.navigate` 回应后立刻关闭页签时，协议显示 `Target.closeTarget` 返回 `success: true`，但随后同一 target 继续提交 `Page.frameNavigated`、加载页面，始终没有 `Target.detachedFromTarget`。Playwright 等待页面 closed 事件而挂住，应用退出也随之等待。旧协议证据：`/private/tmp/aw-user-preview-shutdown-protocol.log`。

精确版本的 [`RenderFrameHostImpl::ClosePage`](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/content/browser/renderer_host/render_frame_host_impl.cc) 将关闭状态附在旧 RFH 上；导航替换 RFH 后可能丢掉关闭状态。上游 [Chromium main 的修正](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/renderer_host/render_frame_host_impl.cc) 针对 [crbug.com/559040906](https://crbug.com/559040906) 取消进行中的导航与 speculative RFH，注释说明该导航会销毁旧 RFH 并抹掉关闭状态。

本分支对开发 Chromium 宿主添加事件兼容：首次正常调用 `page.close()`，关闭期间若观察到同页**主 frame 的新文档提交**，通过浏览器级 CDP 对已登记的同一 target 再次发出关闭。没有定时重试、不关闭整个 partition/context，不撤销请求政策；只有确实已关闭的页签/已移除的登记可幂等返回。监听器先于首次关闭注册、最终解除，事件处理中的协议失败通过受控 Promise 返回；未确认关闭时不吞协议错误。生产 Electron 仍使用其原生销毁方式。

原 shutdown 回归保留并通过：`/private/tmp/aw-user-preview-shutdown-fixed-protocol.log` 记录同 target 的第二次 `Target.closeTarget` 与随后的 `Target.detachedFromTarget`，证明实际销毁完成。两种初次打开失败路径还断言再次关闭同 tab 幂等。

独立只读评审：`text_context` 复核并发打开、等待关联时发送竞态及原生裁切三项 P2 的修复；`task_relay` 对照 Playwright 的关闭状态机和以上 Chromium 精确版本源码，复核事件监听顺序、主 frame 过滤、同 target 隔离、异常传播与清理边界。均未修改本分支文件。
