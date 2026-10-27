---
name: aw-task-requirement
description: Use when you are about to create a task, a batch, a scheduled task or an initiative (tasks_create, batches_create, schedules_create, initiatives_create). How to turn what the user said into a requirement the AI can act on, which workflow to pick, and when a large requirement becomes an initiative instead of one task.
---

# Writing the requirement

The requirement is all the task's AI sessions know about what the user wants: the planner reads it next to the code, every step sees it, and the review checks the result against it. A vague requirement gives a plan that guesses. Write it in the user's language.

## What goes in

1. **Goal**: one or two sentences on what should be true afterwards and which problem that solves.
2. **Scope**: the pages, modules, files or APIs involved when the user named them or the conversation shows them, and what is out of scope ("do not change the export", "no new dependencies").
3. **Acceptance**: results someone can observe or a test can check ("searching an order number shows only that order", "`GET /orders?status=paid` returns only paid orders"). Not "works well" or "is faster" without a number.
4. **Context**: links to specifications or issues (the AI can open them), the files the user attached in this conversation (`attachmentIds`), constraints the user gave (compatibility, a deadline for performance, a library to use).

Keep it to a few lines or a few short paragraphs. Do not invent details the user did not give, and do not write the implementation plan: the planner reads the code and decides. When the user lists several concrete results, also pass them to `tasks_create` as `requirements`, the checklist the task is verified against (one item per result: `title`, `expected`).

For a bug, write how to reproduce it, what happens and what should happen instead; quote the error message when there is one.

## When to ask first

The project is settled when the user names it or your context says they are on its page (or on one of its tasks), even when the name they use differs from the project's name in the app; use that one. Ask in the conversation, in one short message with at most three questions, only when you cannot tell which project, what "done" means for a change of behaviour, or which of several plausible meanings the user has in mind. Do not ask about what the AI finds in the code itself (file names, frameworks, how the tests run). When the user tells you to go ahead, make the reasonable choice and write it into the requirement as an assumption ("Assumption: only the web page, not the mobile app").

## Picking the workflow

Call `agent-workflow-app_workflows_list` and choose by name and description; do not guess keys. As a guide:

- New behaviour: the AI-planned feature workflow. Restructuring without changing behaviour: refactor.
- A defect: bug fix (it reproduces the bug with a failing test first, then fixes the root cause).
- Missing tests: unit tests. Lint and compiler warnings, dead code: cleanup.
- Read-only reports that change no code: code review, security review, version review (changes since a date or commit). Their requirement says what to look at and what the report should answer.
- Thinking before building: design proposal (options and a recommendation) or detailed design (a document committed to the repository).

Batches and scheduled tasks take fixed workflows only (`planning: fixed`); see the skill `aw-recurring-work` for them.

## One task or an initiative

Create an initiative (`agent-workflow-app_initiatives_create`) instead of one task when the user brings a requirements document, several features to analyse, or work that has to be split into work packages and done in phases. One coherent change, even a large one, is one task.

- Without `templateKey` the AI reads the code and breaks the requirement down into phases and work packages. With a template from `agent-workflow-app_initiativeTemplates_list` the phases are fixed (for example design, then build).
- Pass the files the user attached in this conversation in `attachmentIds`.
- The AI breakdown, and a new breakdown or refinement you start, takes a few minutes. Its draft or its failure arrives as your next message and you summarise it then, so tell the user that instead of asking whether to wait.
- To look at an initiative later, read it with `agent-workflow-app_initiatives_get`. The user changes phases and work packages on the page, or asks the AI to break it down again (`agent-workflow-app_initiatives_rebreakdown` with their feedback). Opening the next phase, dropping a work package and the like go through the other `agent-workflow-app_initiatives_*` tools when the user asks.

## Example

Too vague: "优化一下订单页".

Usable: "订单列表页（/orders）在约 5,000 条订单时首屏要 6 秒。目标：首屏 1 秒内显示第一页。改为后端分页（每页 50 条），保留现有的筛选和排序；不改导出功能。验收：/orders 首屏只请求第一页；翻页、筛选、排序的结果与现在一致；现有测试通过。"
