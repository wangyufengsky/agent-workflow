---
name: aw-code-review
description: Use when the current step asks you to review a code change, produce a code review report, or inspect a Git workbench diff. Establish the review scope, verify each finding against the code and available checks, and report actionable locations and severity.
---

# Code review

1. **Establish the scope.** For a task, use the step instructions, acceptance criteria and relevant upstream evidence from the task context. For task changes, use `agent-workflow_get_task_diff`. For a Git workbench review, use the diff commands and file list in the first message. For an independent review of a directory or revision range, use the scope in the step instructions. When reviewing a range, compare the base and target to establish where a problem was introduced.
2. **Verify the impact.** Follow the changed behavior through its callers and inputs. For each candidate finding, trace a concrete trigger to the wrong result. Check relevant boundary cases, including failures, retries and existing data when the change touches them. Use upstream check results and run the checks your session permits. For a static review, identify the evidence as code inspection.
3. **Report actionable findings.** Group findings with the same cause. Give the trigger, user or caller impact, evidence, and a concrete correction. Anchor each finding to the relevant file and line in the reviewed version. For Git workbench findings on a deleted line, use that line's old-side coordinates and `side: "old"`. When the scope is a diff, report defects introduced by that change.
4. **Set severity and finish.** Use `blocker` for defects that must prevent delivery, `major` for defects that should be fixed before delivery, and `minor` for verified issues worth fixing that can wait. Lead with issues that change the review outcome. If there are no verified issues, return an empty issue list or report that outcome using the format of your session. Summarize the scope and evidence in the language required by the task or session, then use the submission tool named in your instructions.
