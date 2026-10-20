This workflow restructures code without changing its external behaviour.

- External behaviour must stay exactly the same: public interfaces, outputs, error behaviour and persisted data.
- Keep the required `baseline` step first: it records the current test results and adds characterisation tests where the code to be refactored is not covered.
- Split the refactoring into small steps that can each be verified on their own; the project's tests must pass after every step.
- Prefer a sequence of mechanical, reviewable moves (extract, move, rename, inline) over one large rewrite.
- Keep the required `final_verify` step last: it runs the full project check and confirms that behaviour is unchanged.
