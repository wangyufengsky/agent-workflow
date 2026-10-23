# AP-05 助手用量与运行时限验证

基线：`origin/main` `7b7bcb84eeed5623c30d98cb6668631499c16f3a`（已包含 AP-01/02/03a/03b/04）。独立分支 `codex/assistant-usage-limits`；不修改主工作目录或 Claude 工作区。

## 范围

- 外部创建/发送前保存单轮记录；真实 StepFinished 输入/输出 token 持久化并按 part id 去重，assistant.parentID 绑定本轮显式 user message id。迟到新消息与报告归旧轮，未知不填零。
- 主页、侧栏、桌宠共用最近/当前轮与会话累计用量行，显示统计起点、未报告轮数、状态和耗时。
- 沿用 `attempt.timeoutMinutes`，每轮固定模型和时限；权限等待暂停运行时限；超时停止，不自动重试。无金额预算、余额、截图或 PDF 能力。
- 迁移仅新增 `0021_assistant_usage`，由 drizzle-kit 从主干 `0020_assistant_session_isolation` 生成；已合并迁移未改动。

## 实际复现与修复

原生 opencode 1.19.0 中，正在执行的 abort HTTP 可能先返回，之后全局 SSE 才消费 MessageAbortedError 与两个 Idle。受控重放在修复前把新轮从 running 错误结束；基础 main 的 busy 也受影响。单纯等第一个 Idle 或固定数量不足以恢复关联。

助手改用原生同步 prompt 的 Promise 关联完成，接受和完成分开：匹配 user marker 后即可返回发送响应，原生 HTTP 最终结果才结束对应轮次。任务尝试保留原 prompt_async 入口。裸 Idle/Error 不结束助手轮次；响应前模型/agent 错误经对应 HTTP 失败报告；未知传输失败保留忙碌供明确停止。

另一个原生探针复现：prompt 刚派发时立即 abort，若 Runner 尚未注册，abort 可以返回成功但模型随后仍启动。现在先用本轮 assistant.parentID marker 或原生 busy/retry 状态确认启动，然后一次 abort 并等待关联完成。启动查询/停止确认整体 10 秒截止（注入 Clock）；无法确认返回失败、保留忙碌，已发出的原请求屏障仍保留，重试不重复 abort。晚成功按原 Aborted/TimedOut 原因收尾，即使先前 HTTP transport 已失败也不留下假忙碌。停止发生在创建外部会话期间时返回非成功，保留草稿及附件。

以下是固定版本的官方源码证据；实现与本机原生探针互相验证：

- [同步 prompt / abort 路由](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L295)：同步请求等待该轮 WithParts，abort 等 cancel；HTTP 与 SSE 是独立通道。
- [Runner](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/effect/runner.ts#L70) 与 [run-state](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/run-state.ts#L52)：Runner 注册/取消共用同步锁；正常完成先发布 idle 再完成 done。启动在实例 scope 中运行，不能以 HTTP 断开代替原生 abort。
- [prompt](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/prompt.ts#L1081)：主循环开头记录 busy，assistant message 的 parentID 指向发起 user message，随后才启动本步 processor。
- [官方客户端 ID](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/app/src/utils/id.ts)：使用相同 timestamp/counter + base62 格式，不用裸 UUID 替代原生 message 排序协议。

## 回归覆盖

`assistant.usage.int.test.ts` 使用真实 SQLite、FakeClock 与捕获的真实事件：实际零/未知、去重、旧轮新消息和迟到报告、模型快照、权限等待/恢复、权限等待中停止、runtime lost/backend restart、创建期间超时和附件重发、停止/删除互斥、删除失败、停止确认截止、截止后重试、无重试的晚成功、未知 HTTP + 晚 abort 成功，以及旧 Error/多个 Idle 在下一轮期间到达。

`assistant.lifecycle.oc.test.ts` 用真实 opencode 与本地脚本模型：文件目录/权限隔离和历史恢复、刚 dispatch 即停止→下一短问完成、权限等待时停止、无效模型/agent 的前置失败。脚本只提供模型响应，不替代原生 Runner、会话、文件工具或权限系统。

UI 用例 `shell-assistant-usage.browser.spec.ts`：主页→侧栏→桌宠共享用量，实际 37/11、未报告停止、实际 0/0、刷新持久化；输出明暗截图。另重跑上下文/用户预览相关用例以检查主干接口整合。

## 最终命令与结果

固定最终实现后顺序执行（低并发，不与本任务其他重套件并跑）：

| 命令 | 结果 | 本机日志 |
|---|---|---|
| `pnpm check` | 全部通过，含类型、Biome、依赖、CSS、状态机文档同步 | `/private/tmp/ap05-final-check.log` |
| `pnpm exec vitest run --project unit --maxWorkers=2` | 59 文件，725 用例通过 | `/private/tmp/ap05-final-unit.log` |
| `pnpm exec vitest run --project int --maxWorkers=2` | 63 文件，375 用例通过，1 条既有 SQL Server 环境跳过，121.36 秒 | `/private/tmp/ap05-final-int.log` |
| `pnpm build` | 生产构建与 bundle 检查通过 | `/private/tmp/ap05-final-build.log` |
| `pnpm exec vitest run --project oc packages/server/src/modules/assistant/assistant.lifecycle.oc.test.ts --maxWorkers=1` | 真实 opencode 2 用例通过，9.58 秒 | `/private/tmp/ap05-final-native.log` |
| `pnpm exec playwright test e2e/shell-assistant-usage.browser.spec.ts e2e/shell-assistant-context.browser.spec.ts e2e/user-preview.browser.spec.ts --project=browser --workers=1` | 5 用例通过，11.0 秒 | `/private/tmp/ap05-final-e2e.log` |

`assistant.usage.int.test.ts` 共 18 个回归。已查看本地忽略目录 `screenshots/assistant-usage-light.png` 与 `screenshots/assistant-usage-dark.png`，用量行与未知/实际零区分可见。合并前完整 browser / OC / Electron 由另一位 agent 在同一提交上独立执行并另行记录。

边界：原生测试使用本地可控模型响应，不代表真实远程模型的质量评估；历史未报告用量保持未知。停止确认失败时用户会看到错误且会话继续保持忙碌，可重试；只有可信响应、原生停止确认或 runtime lost 才解除占用。

## 完整浏览器验收发现的测试隔离问题

在 `401ed5e` 的完整浏览器首轮，J11 的“唯一用户消息”断言命中了前一个 usage 用例留下的三条旧消息；当前消息实际上已经发送并生成确认卡。J11 提前失败后没有消费下一段 fake 脚本，之后出现队列错位。原始 46 通过／7 失败／3 未执行的日志与 trace 保留在 `/private/tmp/aw-final-acceptance/premerge-browser.log`、`premerge-browser-results/`。

后续仅修改 E2E：context/usage 使用自动 fixture 捕获本页面创建接口返回的聊天 ID，在 finally 停止并删除本例自己创建的会话；不清空共享后端、不删除其他用例的聊天。context 的侧栏场景及 J11 显式创建新聊天并等待界面激活，J11 原有断言全部保留。产品代码冻结。

组合 `shell-assistant-context` 3 条 + `shell-assistant-usage` 1 条 + `shell-assistant` 4 条连续运行，最终 8/8 通过。证据：`/private/tmp/aw-final-acceptance/assistant-isolation-green.log` 与 `assistant-isolation-green-results/`。完整 browser/OC/Electron 在该测试修复提交后由独立 agent 重跑。

## 合并前完整验收

独立执行者在固定提交 `211f96c9cda09581d5628e28f8dc3430fb87f057`（生产代码与 `401ed5e` 相同）上串行完成全套；后续仅补本节证据。

| 验证 | 结果 | 证据 |
|---|---|---|
| 最新测试修复后的 `pnpm check` | 通过 | `/private/tmp/aw-final-acceptance/premerge-check-after-isolation.log` |
| 完整浏览器 E2E，1 worker、0 retry | 56 通过，0 跳过、0 flaky；325.66 秒 | `premerge-browser-r2.log`、`premerge-browser-r2.json` |
| `pnpm test:oc` | 5 文件、9 用例通过，0 跳过；45.78 秒 | `premerge-oc.log` |
| 完整 Electron E2E，1 worker、0 retry | 11 通过，0 跳过、0 flaky；117.89 秒 | `premerge-electron.log`、`premerge-electron.json` |

相对证据路径均位于 `/private/tmp/aw-final-acceptance/`。浏览器四主题各 78 页，共 312 张截图；对比度与横向溢出报告均为零。独立查看四主题各自的主页与助手面板，以及用量明暗截图，文字、确认卡、输入框与用量行可读，无新增遮挡。

OC 套件的 bridge 用例调用实际配置模型，其余用例使用真实原生运行时的无模型请求或本地可控模型响应。Electron 的 J10 使用真实模型，完成引导、添加测试项目、修复任务、执行中退出重开并继续到结果卡；其他桌面用例覆盖原生浏览器、桌宠、启动退出、已有 PDF 导出及用户预览。已有 PDF 导出回归不代表本轮增加助手 PDF 输入能力。

本轮按现行 D82 进行本机 macOS 验收；仓库 GitHub Actions 仅手动触发，未把本机结果写成跨平台 CI 已通过。
