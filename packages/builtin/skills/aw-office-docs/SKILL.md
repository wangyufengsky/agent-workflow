---
name: aw-office-docs
description: Use when the user wants a Word or Excel file (a report, minutes, a proposal, a table to share) or wants an attached .docx or .xlsx changed: create_docx, revise_docx, create_xlsx, edit_xlsx, read_sheet, query_sheet. How to structure the document, lay out the workbook, keep large tables out of your output and report what a changed file lost.
---

# Word and Excel files

Files you write go into this conversation's files directory and appear as cards the user can preview, save and open. A source file never changes: every change is saved as a new file. When you are done, name the file the result says was written (a taken name gets a number).

## Before you write

Settle what the file is for and who reads it when the request does not say: a weekly report for a manager, minutes for the attendees, a table to import elsewhere. One question is enough; when the user wants you to go ahead, choose and say what you chose. Use only facts from the conversation, the attachments and tool results; do not invent figures, names or dates.

## Word (`agent-workflow-app_create_docx`)

Blocks are `heading` (level 1–4), `paragraph`, `list`, `table` and `page_break`; in text, `**bold**`, `*italic*` and `[text](https://…)` are kept.

- Use at most three heading levels. Start with what the reader needs most: the conclusion or the decision asked for, then the details.
- Keep paragraphs short. Use a list for parallel items and a table for values the reader compares across rows; do not put prose in tables.
- Common shapes:
  - Weekly report: summary in two or three sentences; done; in progress; problems and help needed; next week.
  - Minutes: date, attendees, topics; per topic the decision; action items as a table (item, owner, due).
  - Proposal: background and problem; options with their trade-offs; recommendation; plan and risks.
- When the user attached a Word document whose look they want, pass it as `style_from`: fonts and heading styles are taken from it.

To rework an attached document, `agent-workflow-app_revise_docx` writes a new file from your blocks with the original's styles. Read the original first (`agent-workflow-app_read_attachment`) and keep its structure unless the user asked for a different one.

## Excel (`agent-workflow-app_create_xlsx`)

- One sheet per subject, with a short name. Give every column a header and a `type` (`text`, `number`, `date`, `percent`, `currency`) so it is formatted; dates as `{ "date": "…" }`, not as text.
- Keep `freeze_header` on for tables longer than a screen.
- For totals and ratios write `{ "formula": "=SUM(B2:B40)" }` rather than numbers you computed, so they stay right when the user edits. Plain text starting with `=` is written as text. References to other workbooks and functions that reach the network are refused.
- **Large tables never go through your output.** To put rows of an attached workbook into a sheet, read its overview (`agent-workflow-app_read_attachment`), find the rows with `agent-workflow-app_query_sheet`, and give the same query as `rows_from`: the app copies every matching row. Look at a few rows with `agent-workflow-app_read_sheet` only to understand the columns.

To change an attached workbook, `agent-workflow-app_edit_xlsx` applies operations in order (set cells, insert or delete rows and columns, add, rename or delete sheets) and saves a new file. Rows and columns are numbered as in the original before your first operation; after an insert or delete, later operations see the new positions.

## What a changed file lost

`edit_xlsx` and `revise_docx` return `lost`: what the new file does not carry over (charts, pictures, pivot tables, headers and footers, comments; formulas whose references no longer match after rows or columns moved). When `lost` is not empty, tell the user in one sentence what is missing and that the original is unchanged. When keeping those parts matters to them, suggest they make the change in Word or Excel themselves.
