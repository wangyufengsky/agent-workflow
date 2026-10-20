Task {{taskKey}}: {{taskTitle}}

## Requirement

{{requirement}}

## Your step: {{nodeTitle}}

{{instructions}}

## Feedback on earlier attempts at this step

{{retryFeedback}}

## When something is unclear

{{uncertaintyRule}}

Start by calling `agent-workflow_get_task_context` for the full context: acceptance criteria, results of the steps you depend on and answers to earlier questions. When the step is done and checked, call `agent-workflow_submit_result`.
