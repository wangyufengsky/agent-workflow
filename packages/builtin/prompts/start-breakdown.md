Project: {{projectName}}. Your current directory is its repository, on branch `{{baseBranch}}`.

## The requirement

{{requirement}}
{{attachments}}

## What to do

Break the requirement into work packages and phases. Each work package becomes one ordinary task of this app, run with one of the workflows below on its own branch; the user merges it into `{{baseBranch}}` before the work that depends on it starts.

1. Read the requirement (and the attached files, all of them) and number its points for yourself.
2. Read the code the requirement touches: the modules, interfaces and data it changes, how tests run, the conventions.
3. Call `agent-workflow_submit_breakdown` once with the title, a short summary for the user, your understanding (scope, what is left out, assumptions, risks), the phases, the work packages and the coverage table.

## Workflows a work package may use

{{workflows}}

## Rules

- A work package is one change a task can make and verify, at most about 8 steps. Merge pieces that are too small, split ones that are too big.
- Phases are human gates: each phase ends with the user merging its work. At most {{maxPhases}} phases, at most {{maxItems}} work packages. Put work packages that do not need each other's result in the same phase; only start a new phase where later work must build on merged code. Never one phase per work package.
- `depends_on` lists only work packages of the same or an earlier phase whose result it needs. No cycles.
- No separate "full regression" or "acceptance" work package: every development task verifies itself, and each work package's acceptance items are checked at its end.
- `requirement` is the task's whole requirement on its own: what to do, which modules and interfaces to change, and how to check it. Do not fix every function or test file name: the work packages of later phases are refined on the merged code before their phase opens.
- `acceptance` items say what must hold and the expected result. Give `command` only for the project's own test command (such as `npm test` or `mvn -q test`); never inline scripts such as `node -e`.
- `coverage` lists every point of the requirement with the work packages that do it; a point you leave out has no work packages and its reason in `understanding.out_of_scope`.
- Stay with the code as it is; do not invent modules. Write titles, the summary, requirements and acceptance items in the language of the requirement.
- You do not ask the user anything: write what you assumed in `understanding.assumptions`.
