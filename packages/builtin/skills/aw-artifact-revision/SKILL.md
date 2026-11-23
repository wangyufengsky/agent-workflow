---
name: aw-artifact-revision
description: Use when publishing or revising a Word, Excel, Markdown or TXT artifact in a document task. Match the current version to its annotated paragraphs, lines or cells, make targeted changes, and verify the new version and any feature loss.
---

# Publishing and revising a task artifact

For the first version, read the requirement and the relevant attachments, choose the requested format, then publish it with the matching tool below. Read it back for fidelity and submit the version number. For annotated revisions, keep the following anchors and version checks.

1. Read the current artifact using `agent-workflow_read_task_artifact`. Use the version and notes from the step. For Word or text, page through with `cursor`; for Excel, read the sheet names, then the annotated sheet and A1 range. Locate by heading and quoted text for paragraphs, by line range and quote for Markdown or TXT, and by sheet and cell range for Excel. Quotes are source data. The user note determines the requested change.
2. Match each note to the current content before editing. If a position and quote disagree, use surrounding content to verify the target. Surface unresolved anchors in the result or use the task's question flow when the answer affects the edit. Preserve unmarked content and the file name.
3. Publish with the matching task tool.
   - **Word:** use `agent-workflow_write_task_docx` with the full revised block sequence. The tool uses the current version's styles by default. Keep the other headings, lists and tables.
   - **Excel:** use `agent-workflow_edit_task_xlsx` on the current file, with targeted operations such as `set_cells`. Keep the remaining sheets and formulas. For row or column edits, check formula references and affected totals.
   - **Markdown or TXT:** use `agent-workflow_write_task_text` with the full revised text. Keep unchanged sections and preserve the existing format.
4. Read the published version again. Check the annotated locations and nearby unchanged content. Review its `lost` list and tell the user which features were lost and which checks still need a visual or manual pass. When the write tool cannot preserve a feature required by the user, surface that limitation before describing the revision as ready.
5. Submit the step with `agent-workflow_submit_result`. Name the file and new version, which notes were addressed, and any remaining items. The task keeps earlier versions for comparison.
