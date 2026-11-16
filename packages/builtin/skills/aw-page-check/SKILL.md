---
name: aw-page-check
description: Use when your step or review changes or concerns what a web page shows or does (a UI change, a UI bug), or a requirement links to a website you need to read. How to check a page in the task's preview with the browser_* tools, act on it, read its logs and layout, check other screen sizes, and handle logins and read-only websites.
---

# Checking pages in the browser

## The task's page preview

`agent-workflow_browser_open` with a path starting with `/` (such as `/orders`) starts the task's page preview, the project's dev server running the code in this worktree, and returns the page as text with element refs (`e12`). Planning sessions cannot open the preview, because the code has not changed yet; they can open websites.

The frontend workflow can infer a supported start script from its worktree when the project has no explicit configuration. It checks the root first, then a single immediate frontend package. Use the task-relative URL so the user sees the same preview, including while the first step is running.

- `PREVIEW_NOT_CONFIGURED`: for a new frontend page, check the worktree's package, start script and page entry. Once they are ready, open the task-relative route. For an existing project whose launch remains ambiguous, report the configuration needed on the project page.
- `PREVIEW_START_FAILED`: read the launch error or log tail first. Correct a missing dependency, script or build failure in scope, then reopen the route.
- `PREVIEW_LIMIT_REACHED`: report that preview capacity is occupied. If the preview is still unavailable after diagnosis, run the relevant project checks and state that the browser verification is pending.

## Checking a change

1. Open the page the step changes and read the snapshot: is the new or fixed element there, with the right text?
2. Do what a user would: `agent-workflow_browser_click`, `agent-workflow_browser_type` (clears the field first; `submit` presses Enter), `agent-workflow_browser_select`, `agent-workflow_browser_press`. Each action returns the new page, whether it `settled`, a `dialog` it answered, and counts of `newErrors`.
3. When something loads or animates, `agent-workflow_browser_wait_for` the text to appear (or `textGone`) instead of acting again.
4. Then `agent-workflow_browser_logs` (`since: "open"` for everything since the page opened): console errors, exceptions and failed requests with method, address and status. An error your change caused is a defect: fix it and check again. Errors that were there before your change belong in your notes, not in your fix.
5. For layout (something hidden, overlapping, off-screen, unclickable), `agent-workflow_browser_inspect` the element: its box, whether it is in the viewport, what covers it, its computed styles. Check the mobile size with `agent-workflow_browser_viewport` (`mobile`, or `tablet`) when the page is used on phones or the change affects layout, then go back to `desktop`.
6. `agent-workflow_browser_screenshot` only when the look itself matters and you can see images; the page text is the main evidence.
7. Recover an action by its error. For `BROWSER_REF_STALE` take a new `agent-workflow_browser_snapshot` and find the target by its role or visible text. For `BROWSER_ACTION_FAILED`, use `details.reason`: inspect `coveredBy` for `covered` and dismiss the overlay or fix unintended overlap, reveal a `not_visible` target, fill prerequisites for `disabled`, and take a fresh snapshot for `detached` or `not_focusable`. Try the action again only after the target or page state has changed. If it still fails, leave the interaction unverified and report the error and evidence.
8. In your notes, say which pages and screen sizes you checked, what you did on them, and what you saw, including errors you found and fixed.

When reviewing, do the steps the requirement describes on the page as well as reading the diff. You may use the page, but you still never edit files; an error the change introduced on the page is an issue to report.

## Websites linked in the requirement

- Open them with `agent-workflow_browser_open` and the full address. Websites are read-only unless the user allowed more: writes the page tries, such as posting a form, are cancelled and listed in `blockedWrites`.
- `BROWSER_SITE_NOT_ALLOWED`: no website rule allows the address. Do not try another address to get around it.
- `BROWSER_LOGIN_REQUIRED`: never type a password. When you can ask (`agent-workflow_ask_user`), ask the user to log in under Settings → Websites → Website login; otherwise continue without the page and say so.
- A search or filter on a read-only website shows nothing while `blockedWrites` lists a `POST`: the site queries with POST. When you can ask, ask the user whether to allow that path as a query path of the website's rule; otherwise continue without it and say so.
