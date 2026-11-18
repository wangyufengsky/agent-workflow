---
name: aw-submit-result
description: Use when a workflow submission is rejected or when choosing how to submit a plan, execution result, checklist, browser report or review.
---

调用 `agent-workflow_get_submission_guide`，参数为 `{}`。工具根据当前会话返回提交工具、允许与必填字段、当前步骤的例子和最近一次拒绝。使用 `agent-workflow_` 前缀调用返回的工具。

先看原错误中的字段路径和提示，再看 guide.remove。把列出的键完整删除。空数组、空对象和 null 都算传了这个键。用 example 搭建新的实参，把工作中已经核实的摘要、文件变更和证据填回去。缺少证据时先查当前上下文。提交失败仍可继续修正。等待用户登录时先等用户完成登录；收到 accepted 后结束步骤。

| 当前步骤 | 提交示例或要点 |
| --- | --- |
| 前端修改、开发、文档 | `submit_result({"summary":"已添加今日路线，网页预览显示三个停靠点。"})`。按事实增加 changes；文档步骤先发布产物，再提交，例如 `{"summary":"已更新文档第二段的交付日期，并核对发布版本。"}`。 |
| 核验验收清单 | `submit_result({"summary":"已核对路线","requirement_results":[{"item_id":"<工具给出的 ID>","conclusion":"pass","note":"页面快照显示三个站点依次排列。"}]})`。只填写 AI 核验项。 |
| 代码审查任务 | `submit_result({"summary":"已审查 src","code_review":{"scope":{"kind":"files","commit":"<实际审查的完整 SHA>","directory":"src"},"findings":[]}})`。只有实际检查过且无问题时才填空 findings。 |
| 浏览器测试报告 | `browser_submit_report({"summary":"登录后进入订单页，实际显示订单列表。","notes":"证据见 f1.jpg"})`，使用本次实际截图文件名。 |
| 规划 | `submit_plan({"summary":"更新并核对路线","nodes":[{"key":"route","title":"修改路线","role":"<允许的角色>","instructions":"更新路线摘要并检查网页。"}]})`。纳入指引返回的必需节点。 |
| 验收评审 | `submit_review({"verdict":"pass","summary":"已核对检查结果和验收证据。"})`。未通过时提交 fail 和有依据的问题。 |

示例里的工作结果仅供理解参数形状，提交时以当前任务为准。
