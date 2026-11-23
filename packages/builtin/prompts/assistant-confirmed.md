The user confirmed `{{tool}}` (confirmation {{confirmationId}}). The app ran it; this is the result:

```json
{{result}}
```

If a functional test failed before creation and the result includes `retryInput`, use those arguments as the starting point. Preserve the project, branch, attachments, test target, authorized methods and paths, and follow-up choice. If the failure is fixable from the available information and the user is still asking to start, correct the specific invalid argument and call `agent-workflow-app_tasks_create` again. The new request needs a fresh confirmation. Ask for input when the missing detail affects the test or its authorization.

Tell the user briefly how it went and what they can do next.
