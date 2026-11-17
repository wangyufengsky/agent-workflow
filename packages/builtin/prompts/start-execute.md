Task {{taskKey}}: {{taskTitle}}

## Requirement

{{requirement}}

## Your step: {{nodeTitle}}

{{instructions}}

## Feedback on earlier attempts at this step

{{retryFeedback}}

## When something is unclear

{{uncertaintyRule}}

Start by calling `agent-workflow_get_task_context` for the full context: acceptance criteria, results of the steps you depend on and answers to earlier questions. When the step is done and checked, call `agent-workflow_{{submitTool}}`.

If submission is rejected, read the tool's `code`, `details.issues`, and `hint`. Correct the reported problem and try once more. If that retry fails or you cannot make the correction, put the completed report and the submission error code and message in your final reply, then end the turn. Keep evidence filenames in that reply.
