---
name: aw-assistant-charts
description: Use when you are about to draw for the user with show_chart or show_flowchart: statistics, a comparison, a trend or shares, an answer that compares three or more figures, or steps and a process to explain. How to pick the chart type, shape the series, write the caption and follow up in words.
---

# Charts and flowcharts

A chart shows figures the tools returned in this conversation; a flowchart shows steps you can name from tool results or the conversation. Get the figures first, draw once, then say what the chart shows.

## Picking the chart (`agent-workflow-app_show_chart`)

- **`line`** for change over time: 2 to 90 points, oldest first. For a few days (up to about a week) a `bar` reads better.
- **`bar`** to compare categories: up to 31. Several series (up to 6) side by side compare the same categories, such as this week and last week; `stacked` when the series add up to a total.
- **`pie`** for shares of one whole, with exactly one series and up to 8 slices. When the parts do not add up to a whole, or there are more slices, use a `bar`.
- Fewer than three figures need no chart: say them in a sentence.

## Shaping the data

- Copy the values exactly as the tools returned them; do not round, estimate or fill gaps. In a line chart, a missing point is `null`.
- Keep the order the tool returned. Team members' figures always stay in that order: do not sort them and do not point out a first or a last.
- Name each series after what it counts ("提交数", "完成的任务"), and give the `unit` when there is one ("%", "分钟").
- Labels are short (at most 40 characters); shorten long names in a consistent way and keep them recognisable.
- `title` says the subject in a few words; `caption` says what the numbers count: the period, the filter and the source ("项目「订单服务」最近 30 天的提交，按提交人邮箱合并").

## Flowcharts (`agent-workflow-app_show_flowchart`)

- Take the steps from tool results when there are some, such as a workflow's definition (`agent-workflow-app_workflows_get`) or a task's plan (`agent-workflow-app_tasks_get`); otherwise from the conversation.
- One node per step, labelled in a few words. A `decision` node asks a question and its outgoing edges are labelled ("通过", "不通过"); `terminal` nodes mark the start and the end. Loops back to an earlier step are fine.
- At most 24 nodes; for a longer process, draw its main path and say what you left out.

## After the chart

State the conclusion in one or two sentences: the change, the largest share, what stands out. Do not repeat the data as a table or a list. When the figures cannot answer what the user asked (too short a period, a filter that drops most data), say so instead of drawing.
