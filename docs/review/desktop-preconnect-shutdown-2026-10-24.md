# 桌面应用退出时预连接阻塞：诊断与回归

2026-10-24；修复分支 `codex/assistant-desktop-close-diagnostics`，基线 `739ee40b20fa62fdfb14b8bcef7c09c450c7dd28`。本轮只修桌面退出生命周期，不增加助手能力。

## 已复现的根因与修改

Chromium 的 NetworkService 可以为本应用默认会话保留尚未发送 HTTP 请求的 TCP 预连接。桌面 main 原来先等待后端停止；后端的 HTTP `close()` 又在等待该连接关闭，而默认会话直到应用退出才释放它，形成等待环。

修复仅调整 `will-quit` 后的顺序：窗口关闭后，先等待 `session.defaultSession.closeAllConnections()`，再请求后端执行原有关闭流程，最后退出 main。该 API 会取消默认会话里尚未完成的网络请求；不声称保留这些请求，也不扩展到网站与预览的其他会话分区。后端停止 opencode、预览及数据库的原有收尾顺序不变；没有超时延长、自动重试或强杀兜底。

## 诊断证据

首次完整 Electron 验收有一次桌宠用例退出超时，之后保留原代码与原断言重跑完整套件，又在同一用例的 `finally app.close()` 复现。第二次 trace 确认关闭桌宠、窗口数断言已经通过；挂起的是应用关闭。两次失败均保留，不能因后来的诊断轮通过而记为已修复。原始失败未采集实时 socket 状态，因此以下受控实验证明的是可确定复现、与该症状一致的退出等待环。

1. **真实 OpenCode 启动屏障。** 临时插件在独立 HTTP gate 等待，确保 runtime 仍为 `starting`、`config.get()` 尚未完成。保持 gate 关闭时，`buildApp.close()` 仍在 20 ms 内结束，子进程已退出。启动中的 `fetch failed: other side closed` 也会出现在正常关停中，不能单独作为故障原因。
2. **真实 TCP。** 在真实 `buildApp` 后端建立连接，分别不发送任何字节、只发送半段请求头。两者在 5 秒观察窗口内都未关闭；仅销毁实验自己的 socket 后，后端分别在 8 ms / 15 ms 内关闭。FakeOpencode 只隔离 AI，不替代 HTTP 或 SQLite。
3. **真实 Electron 默认会话。** `defaultSession.preconnect()` 向当前后端的独立 localhost 连接池建立连接。外部 `lsof` 确认 NetworkService 与 utilityProcess 双端 `ESTABLISHED`。`app.close()` 开始 5 秒后，后端监听已关闭，其他连接进入 `CLOSE_WAIT`，唯独这条预连接仍双端 `ESTABLISHED`。释放实验 gate、调用该隔离应用默认会话的 `closeAllConnections()` 后，136 ms 内 main 以 0 退出，151 ms 内 `app.close()` 完成。没有杀进程。

以上临时诊断代码全部移出工作树，留存在 `/private/tmp/aw-final-acceptance/`，没有提交生产诊断钩子。主要证据：

- `postmerge-electron-final-*`：第二次原始完整套件失败与 trace。
- `close-plugin-gate.log`、`close-plugin-gate-events.json`：真实 OpenCode 初始化屏障通过。
- `close-tcp.log`、`close-tcp-*-events.json`：纯 TCP / 半请求两个确定失败。
- `close-preconnect-native.log`、`close-preconnect-native-events.json`、`close-preconnect-native-results/`：原生等待环、实时连接状态、释放后正常退出。

## 永久回归与验证

在 `e2e/launch.electron.spec.ts` 新增一项真实 Electron 回归。测试内的 TCP 转发代理以连接事件确认默认会话的预连接已经连到真实后端，断言没有发送 HTTP 字节，随后要求应用关闭并以 0 退出。该屏障不依赖 macOS `lsof`、sleep 或测试重试；失败清理只销毁本用例创建的代理 socket，且发生在关闭断言之后，不能让清理动作伪造通过。

| 验证 | 结果 | 证据文件前缀 |
| --- | --- | --- |
| 未修改生产代码时的新回归 | 0 通过 / 1 失败；应用关闭在默认 5 秒断言窗口内未完成；总 10.957 s | `close-preconnect-regression-red` |
| 修复后首次定向验证 | 原桌宠与启动用例通过；新回归的应用关闭已在 457 ms 完成，但关闭后再调用 Playwright `app.process()` 时通道已释放，观察代码抛错 | `close-preconnect-regression-green` |
| 缓存真实 ChildProcess 后的最终定向验证 | 3 / 3 通过，0 跳过、0 flaky；总 10.579 s。桌宠 3810 ms，启动 1483 ms，新回归 1631 ms（其中应用关闭 161 ms）；原退出码断言保留 | `close-preconnect-regression-green-r2` |
| `pnpm check` | 通过，类型 / lint / 依赖边界 / CSS / FSM 文档同步 | `close-preconnect-check.log` |
| `pnpm build` | 通过，生产包检查 5 个文件通过 | `close-preconnect-build.log` |

命令：

```sh
pnpm check
pnpm build
pnpm exec playwright test e2e/launch.electron.spec.ts e2e/companion.electron.spec.ts --project=electron --workers=1 --retries=0 --trace on
```

以上运行在 macOS，Electron 44.9.0、Playwright 1.64.1、Node 24.19.0。回归使用标准 TCP 与 Electron API，但不把本机结果称为 Windows/Linux 真机通过。完整 `verify`、浏览器、OC、Electron 套件在本修复合并后的同一主干提交串行执行；本记录不预填其结果。
