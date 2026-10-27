---
name: aw-task-diagnosis
description: Use when the user asks why a task failed, is stuck, is waiting or takes long, or what to do next with it. Walks through the task, its timeline, the failing step's checks and the AI runtime, names the cause with the line that shows it, and picks the matching next action.
---

# Diagnosing a task

Find the actual cause before you suggest anything, and quote the line that shows it: an error message, a failing test, a check's output. Answer in the user's language and keep it short: the cause, the evidence, the next step.

## Steps

1. Find the task. Use the one the user names (number or title) or the one the page context names; otherwise call `agent-workflow-app_tasks_list` and ask which one only when several fit.
2. `agent-workflow-app_tasks_get`: its state, current phase, steps, the items waiting for the user and its result. Many "stuck" tasks are waiting for the user: a question, a plan to confirm, a step to accept, a result to merge. If so, say what it waits for, offer to open it (`agent-workflow-app_open_page`) and stop.
3. `agent-workflow-app_tasks_timeline`: what happened in order. Note which step and which attempt went wrong, which check failed, and whether it was already retried.
4. `agent-workflow-app_nodes_get` for the step that failed or is running: its instructions, the submitted result, each check's result (the check command's exit code and output, the page check's failures, the AI review's issues) and the attempts with their errors.
5. Only when the trouble is outside the task's own work (attempts end with an error of the AI session instead of a failed check, or a running task has not moved for a long time): `agent-workflow-app_system_environment`, and in pro mode `agent-workflow-app_system_runtime` and `agent-workflow-app_system_runtimeLogs` (the last lines of the opencode log).

## Causes and next steps

Name one cause. If two fit, say which the evidence supports better.

- **Waiting for the user.** Say what is needed and where. Answer a question or accept a step only with the user's own answer.
- **The check found a defect in the code** (tests fail, type or lint errors, the page check reports a console error or a failed request). The AI's change is wrong or incomplete. For a failed task, offer `agent-workflow-app_tasks_retry` with a note that names the failing test or output; for a task waiting for review, `agent-workflow-app_tasks_requestChanges` with the concrete change. Put the quoted lines into the note: the next attempt sees it.
- **The check command itself is wrong** (command not found, a script the project does not have, a check that needs a service the project does not start). Offer `agent-workflow-app_tasks_updateCheckCommand` with the command the project really uses; ask the user for it, or look it up with `agent-workflow-app_knowledge_ask` when they do not know. Set `updateProject` only when the user wants the project's own check command changed too.
- **The environment could not run the check** (the page preview never started, a database or network the check needs is out of reach). Tell the user what to fix. `agent-workflow-app_tasks_skipCheck` only when the user asks for it after you said that the result will be marked unverified.
- **The requirement was unclear or the plan went the wrong way** (review issues about missing parts, assumptions that contradict what the user wanted). While the plan waits for confirmation, send the user's feedback on it with `agent-workflow-app_tasks_replan`; after that, offer a new task with a clearer requirement.
- **The AI runtime or the model** (opencode not ready, a login that expired, a quota or rate limit, an unknown model, timeouts). The user fixes the login or the model in the settings; restarting opencode (`agent-workflow-app_system_restartRuntime`) interrupts every running AI session. Then the task can continue with `agent-workflow-app_tasks_retry`.
- **The same failure in every attempt.** Retrying unchanged will fail again. Suggest a note that says what to do differently, a different check, or splitting the work into a smaller task.

## Do not

- Do not guess a cause the tools did not show. When the evidence is missing, say what you checked.
- Do not paste whole logs or outputs; quote the few lines that matter.
- Do not retry, skip a check or change a check command before the user agrees; such tools ask for confirmation anyway, so say in one sentence what will happen.
- `agent-workflow-app_nodes_retry`, `agent-workflow-app_system_runtime`, `agent-workflow-app_system_runtimeLogs` and `agent-workflow-app_system_restartRuntime` need pro mode. In simple mode, say so instead of calling them.
