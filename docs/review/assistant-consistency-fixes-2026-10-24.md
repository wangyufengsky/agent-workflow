# AI 助手 4 项一致性缺陷修复

日期：2026-10-24。基线：`feat/U-attachments@eeb1563`。范围只包含[能力评审](ai-assistant-capability-2026-10-24.md)中的 F1–F4 与必要回归；能力扩展未实施。

提交分支：`codex/assistant-consistency-fixes`，基于 `main@5bb8f24`（与评审基线内容相同）。本修复按用户指定顺序先合入主线，保留 `0018_assistant_outbox`。后续需求清单分支合入时，应基于包含本迁移的主线 schema 重新生成下一条迁移及 snapshot / journal，不直接合并双方独立生成的 `0018_snapshot.json`；本次不修改需求清单分支或其工作区。

## 修复与根因

| 缺陷 | 根因 | 修复后的行为 |
| --- | --- | --- |
| F1：无返回值操作成功，确认接口与列表却失败 | `undefined` 经 JSON 序列化丢失 output 字段，读出时违反结果契约 | 操作边界将无返回值成功规范为 `output: null`；数据库 JSON 读取边界兼容旧版 `{ "ok": true }`。删除实际成功后，确认接口、卡片列表和模型回传均成功 |
| F2：并发首条消息创建两个底层会话 | 首次异步建会话之前未占用发送入口 | 用户发送与应用回传共用每对话发送状态；建会话前即占用，竞争请求返回 409 `ASSISTANT_BUSY`。失败释放发送权；模型空闲事件早于发送响应也不放行竞争请求 |
| F3：待回传确认结果在后端重启后丢失 | outbox 仅存在于内存 | 新增 SQLite 持久化队列；确认结果和待发消息在同一事务保存，取消状态和取消消息亦同。发送失败保留，重启后随下一条消息恢复，发送成功才删除当次消息，恢复不重执行业务操作 |
| F4：原页面对象删除后，成功操作回传失败 | 系统回传沿用用户旧页面的严格对象校验 | 区分用户消息和应用消息；应用回传遇到明确的对象不存在错误时注明原页面已失效，继续投递成功结果。其他错误继续抛出，用户主动发送仍严格校验页面 |

主要代码：[`assistant.confirmations.ts`](../../packages/server/src/modules/assistant/assistant.confirmations.ts)、[`assistant.service.ts`](../../packages/server/src/modules/assistant/assistant.service.ts)、[`assistant.context.ts`](../../packages/server/src/modules/assistant/assistant.context.ts)、[`assistant.repo.ts`](../../packages/server/src/modules/assistant/assistant.repo.ts) 与[结果契约](../../packages/shared/src/contracts/api/assistant.ts)。

## 回归证据

先将 4 个复现整理为正式集成测试，在产品代码修复前运行，4 项均失败；修复后全部通过，再补建会话失败释放和空闲事件提前到达两个边界用例。原始复现输出保留在[评审证据目录](assistant-review-evidence-2026-10-24/)。

新增 [`assistant.recovery.int.test.ts`](../../packages/server/src/modules/assistant/assistant.recovery.int.test.ts)，共 6 项：

1. 同一新对话并发首条消息：一个 200、一个 409，只建立一个底层会话。
2. 无返回值删除：真实删除成功、确认接口和列表成功、模型收到 null 结果；重启后可读取旧版缺失 output 的记录。
3. 已执行结果经历运行时断线、一次发送失败和后端重启后仍送达；不会覆盖用户后来修改的业务数据，送达后不再混入下一轮。
4. 创建会话失败后不残留 busy，下一条用户消息正常开始。
5. 模型空闲事件早于发送响应时拒绝竞争用户消息，新入队结果按序发送且不重复。
6. 确认期间原页面对象已删除，确认接口和成功结果仍正常回传。

SQLite、文件系统、Git 和 HTTP/MCP 接口均为真实实现；仅 opencode 使用 FakeOpencode。竞态测试使用可显式释放的 Promise 屏障，无 sleep 或测试重试。

## 数据与恢复边界

通过 `drizzle-kit generate --name assistant_outbox` 生成新迁移 [`0018_assistant_outbox.sql`](../../packages/server/migrations/0018_assistant_outbox.sql)，包含 snapshot 和 journal；不修改已有迁移。启动时沿用现有迁移机制。同步更新数据模型、API 与助手文档（10 / 11 / 15）。

队列保证应用重启后仍保存尚未确认发送成功的消息。若 opencode 已接受消息、但应用尚未删除队列时进程退出，恢复可能重复通知；没有宣称跨进程的恰好一次投递。恢复代码只发送已存结果，不重新调用业务操作。业务操作执行中途退出且尚未保存结果的恢复，不属于本次已复现 F3 场景，未扩展处理。

## 验证

- 6 项新增回归全部通过；服务端类型检查通过。
- 全量单元测试：57 个文件、712 项通过。
- `pnpm verify` 最终退出码 0：全量类型检查、Biome、依赖边界、CSS 与状态机文档检查通过；集成测试 55 个文件、326 项通过、1 项跳过（既有 SQL Server 用例不适用的主键 INCLUDE 列检查）；桌面生产构建、插件构建与 `check-prod-bundle` 全部通过。
- 助手与桌宠浏览器流程：`shell-assistant.browser.spec.ts`、`shell-companion.browser.spec.ts`，8 项全部通过，0 重试。
- `git diff --check` 通过。完整输出：[全量验证](assistant-review-evidence-2026-10-24/fixes-verify.txt)、[浏览器验证](assistant-review-evidence-2026-10-24/fixes-e2e.txt)。
- 真实模型与 Electron 本轮未运行；上述结果不代表真实模型多轮准确率验收。

验证过程中，第一次全量类型检查遭遇并行任务移走无关文件；之后沙箱阻止了 Chromium 进程通信、文件监视及部分子进程管理。保留失败输出，获准使用正常本机权限后复验，未因此修改产品实现或降低断言。
