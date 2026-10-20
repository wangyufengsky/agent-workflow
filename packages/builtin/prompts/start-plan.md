Task {{taskKey}}: {{taskTitle}}
Workflow: {{workflowName}}

## Requirement

{{requirement}}

## When something is unclear

{{uncertaintyRule}}

Start by calling `agent-workflow_get_task_context`: it lists the roles you may assign, the steps this workflow requires and its planning guidance. Read the code the requirement touches, then call `agent-workflow_submit_plan`.
