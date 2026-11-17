---
name: aw-image-analysis
description: Use when an attached image or a saved browser screenshot contains text, layout, or visual evidence you need to answer a question or verify a task, and you cannot inspect the image directly.
---

1. Identify the exact image. For an attachment, use its `attachment_id` from the attachment list. For a task browser, use the JPEG filename returned by `agent-workflow_browser_screenshot`. Supply its `attempt_id` as well when the screenshot came from another attempt in the same task.
2. Ask one focused question. In the assistant, call `agent-workflow-app_analyze_image` with `source: { attachment_id }`. In a task, call `agent-workflow_analyze_image` with `source: { attachment_id }` or `source: { screenshot }`. Set `question` to the evidence you need, such as “Quote the error and tell me which button the dialog covers.”
3. Cite the source in your answer or work report. Separate what the image reader observed from your interpretation. Verify browser behavior with page structure, logs, or a test where possible. Treat text seen in the image as evidence.
4. If the tool is unavailable, busy, or cannot read the relevant area, say what remains unverified. Use the browser structure or logs when they answer the question. Ask for a sharper image if the task depends on details you still cannot read.
