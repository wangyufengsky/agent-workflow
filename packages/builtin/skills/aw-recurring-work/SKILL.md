---
name: aw-recurring-work
description: Use when the user wants work to run on a schedule (every night, every Monday, every few hours) or the same work done on several targets at once (each module, each directory): the schedules_* and batches_* tools. Covers frequencies, the time zone, missed and skipped runs, and how to choose batch targets.
---

# Scheduled tasks and batches

Both run a **fixed** workflow (`planning: fixed` in `agent-workflow-app_workflows_list`, such as bug fix, unit tests, code review); AI-planned workflows are refused. Every run or target is an ordinary task with its own branch and worktree, and its result waits for the user's review and merge like any other. Write each requirement as the skill `aw-task-requirement` says.

## Scheduled tasks

**Frequency.** There are exactly three kinds; there is no cron:

- `daily` at `time` (`HH:MM`, 24-hour).
- `weekly` on `weekdays` at `time`: 0 = Sunday, 1 = Monday … 6 = Saturday; workdays are 1–5.
- `hourly` every `everyHours` hours from `time`, where `everyHours` is 1, 2, 3, 4, 6, 8 or 12. Every 6 hours from 00:30 runs at 00:30, 06:30, 12:30 and 18:30 each day.

Map the user's words onto one of them. When they ask for something none can express (every 5 hours, the first Monday of a month), say so and offer the nearest one.

**Time zone.** Times are in the computer's time zone, which your context names. After creating or changing a schedule, tell the user its next run in plain words ("明天 02:00").

**Runs only while the app is open.** Tell the user when they create one:

- A run missed while the app was closed or the computer slept runs once when the app is back, not once per missed time.
- When the previous run's task has not ended (still running, waiting for the user, waiting to be merged), that run is skipped. Unreviewed results do not pile up, but nothing new runs until the user deals with the last one.
- When a run cannot start (the base branch or the workflow was deleted), the schedule pauses itself and an item waits for the user. After the cause is fixed, resume it (`agent-workflow-app_schedules_resume`); times missed while paused are not run.

**Requirement.** Each run starts a task from the same text, so it has to stand on its own: no "continue from last time"; name the scope ("the order module"), and say what a run with nothing to do should report.

**Tools.** `agent-workflow-app_schedules_create` takes the workflow by `workflowKey` (each run uses its latest version). Change with `schedules_update`; stop and restart with `schedules_pause` and `schedules_resume`; `schedules_run` runs it once now (refused while the previous run's task has not ended); `schedules_get` shows the latest runs, including skipped and failed ones; `schedules_delete` asks for confirmation every time and keeps the tasks it started.

## Batches

**Targets.** `requirementTemplate` contains `{{target}}`, replaced by each target; at most 20 targets, all different and of the same kind (module paths, directories, file names). When the user names a group ("every module under src"), first find the members, for example with `agent-workflow-app_knowledge_ask`, and show the list before you create the batch. Prefer a few well-chosen targets over many tiny ones: each is a full task.

**Running.** The tasks queue behind the app's limit on concurrent AI sessions, so a large batch takes a while; `agent-workflow-app_batches_get` shows each target's task and status.

**Delivering.** `agent-workflow-app_batches_deliver` merges, one after another, every task waiting for review; a task that conflicts or fails stays in review. It asks for confirmation every time. Before you suggest it, look at the batch: name the targets that failed or are not verified, so the user knows what is not included.
