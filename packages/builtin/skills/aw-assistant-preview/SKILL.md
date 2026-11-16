---
name: aw-assistant-preview
description: Use when the user wants to see a task's page, asks why the page they are looking at shows an error or looks wrong, wants a frontend page built, revised or checked, or wants a website read: previews_start, open_page task_preview, browser_read, browser_readUrl. How to start and open the preview, read what the user sees and explain console errors and failed requests.
---

# Page previews and websites

A task's page preview is the project's dev server running the task's branch in its worktree. The user looks at it in a preview tab of the app. You can start it, open the tab, read the page the user has open and read websites; you cannot click or type on pages.

## Showing a task's page

1. `agent-workflow-app_previews_start` with the task. It asks the user to confirm, then starts the dev server and waits until it is ready.
2. Once it runs, open the tab with `agent-workflow-app_open_page` (`task_preview` with the task).

When it fails:

- `PREVIEW_NOT_CONFIGURED`: the project has no preview settings yet. The user sets the start command and pages on the project's page; offer to open it.
- `PREVIEW_START_FAILED`: the dev server exited or never got ready. Quote the last lines of its log from `details.logTail` and name the likely cause (a missing dependency, a port in use, a build error in the task's code).
- `PREVIEW_LIMIT_REACHED`: too many previews run at once. `details.taskIds` names the ones in use; the user closes one, or you stop one they no longer need (`agent-workflow-app_previews_stop`) when they agree.

`agent-workflow-app_previews_get` tells whether a preview runs, its address and the end of its log.

## Reading what the user sees

`agent-workflow-app_browser_read` (no arguments) reads the preview tab the user has open in this conversation's context: its address, the page text, console errors and failed requests. It fails with `BROWSER_NOT_OPEN` when no preview tab is open (or it was closed or the preview stopped); then ask the user to open it, or open it yourself as above, and read again.

To explain an error:

- Quote the console error or the failed request (method, address, status) the result shows; do not paraphrase it away.
- Name what it points to: an exception's file and line, a request to an address that does not exist (404), a server error (500, look at the preview's log with `previews_get`), a request blocked by the browser.
- Connect it to the task: the page runs the task's code. When the task waits for review, offer to send it back with the quoted error (`agent-workflow-app_tasks_requestChanges`); for a failed or stuck task, look at the task as the skill `aw-task-diagnosis` says.

## Frontend workbench

- To build a new page, load `aw-task-requirement`, select 前端开发 from `agent-workflow-app_workflows_list`, and create the task with the target project, framework when requested, route and observable requirements. If the user gives an empty folder, help add it through the project Git initialization flow before creating the task. Open it with `agent-workflow-app_open_page` using `task`. The workbench opens the preview when the first page is available.
- To suggest improvements, read the bound preview with `agent-workflow-app_browser_read`. Use its visible structure, layout dimensions, overflow and any selected element. For each suggestion name the path, viewport, element and observable outcome. Ask the user to point at an element if needed. Measurements and page text are the evidence. Visual preferences and screenshot comparison are for the user to check in the preview.
- When the user asks you to apply a change, call `agent-workflow-app_tasks_get` for the page's task. When it is ready for review, call `agent-workflow-app_tasks_requestChanges` with `reason: user` and the agreed feedback. Include the path, viewport, target and expected result yourself. The confirmation card carries your request into the same task as its next revision. If a round is running, help the user draft its follow-up and wait for it to be ready before submitting.
- When the user says the page is ready for final acceptance, call `agent-workflow-app_tasks_finishFrontend` with the task ID and known local path. After confirmation, watch its verification status with `tasks_get`. State that delivery is available once the task returns to review with `frontend.verified: true`.

## Reading a website

`agent-workflow-app_browser_readUrl` with a full address reads a page read-only: its text and its console log. A page that needs a login returns `BROWSER_LOGIN_REQUIRED`: the user logs in under Settings → Websites → Website login (pro mode), then you read again. Sites the user's website rules do not allow return `BROWSER_SITE_NOT_ALLOWED`. A whole read is cut off after 30 seconds (`BROWSER_READ_FAILED`).

When the user needs something done on a page (clicking, filling a form), tell them the steps instead.
