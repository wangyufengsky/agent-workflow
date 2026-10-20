Task {{taskKey}}: {{taskTitle}}

## Requirement

{{requirement}}

## Step under review: {{nodeTitle}}

### Its instructions

{{instructions}}

### What it reported

{{resultSummary}}

## Focus of this review

{{focus}}

Call `agent-workflow_get_task_context` for the step's acceptance criteria and the results of earlier steps, and `agent-workflow_get_task_diff` to see every change made in this task so far. Then call `agent-workflow_submit_review` once: `pass` when the step does what its instructions and the requirement ask, `fail` with at least one blocker or major issue otherwise.
