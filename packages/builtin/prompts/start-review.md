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

1. Call `agent-workflow_get_task_context` for the step's acceptance criteria and the results of earlier steps.
2. For code-change acceptance, your next action is to call the `skill` tool with `{"name":"aw-code-review"}`. Apply it to the code and use `agent-workflow_get_task_diff` to see the changes made in this task so far. For other acceptance, follow the step's requirements and inspect the relevant output.
3. Call `agent-workflow_submit_review` once. Report `pass` when the step meets its instructions and the requirement. A `fail` verdict includes at least one blocker or major issue.
