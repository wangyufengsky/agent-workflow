This workflow restructures code without changing its external behaviour.

- External behaviour must stay exactly the same: public interfaces, outputs, error behaviour and persisted data.
- Keep the required `baseline` step first: it records the current test results and adds characterisation tests where the code to be refactored is not covered.
- Split the refactoring into small steps that can each be verified on their own; the project's tests must pass after every step.
- Prefer a sequence of mechanical, reviewable moves (extract, move, rename, inline) over one large rewrite.
- Give steps that touch page code `acceptance.pages` with the affected paths (when the project has a page preview), together with `command: "$PROJECT_CHECK"`, so a page broken by a move is caught at that step. The required `final_verify` step already checks the project's key pages.
- Keep the required `final_verify` step last: it runs the full project check and confirms that behaviour is unchanged.

仅当任务需要验证项目数据库里的事实时，才安排 database_analyst 只读步骤。把调查口径和预期证据写进步骤，后续修改由开发角色处理。
