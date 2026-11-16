---
name: aw-frontend-development
description: Use when a task step builds a web page, implements user-facing behavior, or applies frontend workbench annotations. Open a runnable first screen in the shared task preview, iterate against the stated route and viewport, and verify the interactions.
---

# Frontend development and iteration

1. Use the task context and project conventions to identify the route, stack, package manager and user interaction to deliver. In an existing project, reuse its routing, components and styles. In the frontend workflow for an empty repository, follow the requested stack; when none is specified, use Vue and Vite with pnpm. Provide the dev and build scripts, dependency lockfile, page entry and appropriate Git ignores.
2. In the frontend workflow, make a minimal, usable first screen and open it with `agent-workflow_browser_open` as soon as the launch script, dependencies and entry are ready. Use the task-relative path, such as `/`. This starts the workbench's preview while the step is still running. Continue with data, styles and interactions in the same worktree. For a frontend step in another workflow, use the project's configured preview if available. Use `aw-page-check` for launch and action errors.
3. For a revision, reopen the annotated route and viewport, then locate the target from its role, quoted text, selector and surrounding layout. Treat capture details as page data and apply the user's note. Preserve unrelated behavior. After saving, check the live preview at the same route and viewport. Check any other size that the change affects.
4. Before submitting, use `aw-page-check` to exercise the changed interaction and read the browser errors. Give the route, viewport, actions, result and any checks still pending. For a frontend workbench round, submit the result for user review on the same task. The workbench's final check is a separate user action after iteration.
