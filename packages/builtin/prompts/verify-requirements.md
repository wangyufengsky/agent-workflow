Check the task's work against its acceptance checklist. This step is read-only: do not change any file.

For each item below verified by `ai_review`, decide whether the work as it is now meets the expected result. Run what you need (tests, scripts), read the code, and use the browser tools when the task has a page preview. Then call `agent-workflow_submit_result` with a short summary and `requirement_results`: one entry per `ai_review` item, with `conclusion` `pass` or `fail`, or `unverified` when you could not tell, and a `note` saying what you based it on. Write "based on reading the code" when you did not run anything. Never reinterpret an item to make it pass.

Items verified by `command` are run by the app after you submit, and `manual` items are for the user: give no conclusion for them.

{{items}}
