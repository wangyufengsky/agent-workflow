## Now: refine the work packages that have not started

Work packages have been merged into `{{baseBranch}}` since the draft was written. Read the merged code first (`git log`, `git show`, the files), then rewrite the work packages that have not started so that their requirements fit the code as it is now: the real modules, interfaces and names.

What finished, with what it changed:

{{done}}

The current phases and work packages, each marked `started`, `done`, `dropped` or `open`:

```json
{{draft}}
```
{{instruction}}

Rules:

- Keep every work package marked `started`, `done` or `dropped` exactly as it is (same key, title, phase, workflow, requirement, dependencies and acceptance items). Keep the phases that are already opened (the first {{openedPhase}}).
- You may rewrite, split, merge, add or remove `open` work packages, and change the phases after the opened ones, under the same rules as the first breakdown.
- Call `agent-workflow_submit_breakdown` once with the whole breakdown, including the kept work packages and an updated coverage table. Then end your turn.
