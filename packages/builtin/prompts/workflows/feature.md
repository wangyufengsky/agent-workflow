This workflow implements a new feature.

- Plan 2 to 8 steps. A small feature may need only one implementation step besides the required final verification.
- Order the work as data and interfaces first, then the implementation that uses them, then tests that pin down the new behaviour. Tests may also be part of the implementation step that introduces the behaviour.
- Steps that do not need each other's results must not depend on each other, so they can run in parallel (for example backend and frontend parts that only share an interface defined in an earlier step).
- Use the developer role for implementation and the tester role for test-only steps.
- Give steps that change pages `acceptance.pages` with the paths they change (when the project has a page preview), together with `command: "$PROJECT_CHECK"`. The required `final_verify` step already checks the project's key pages.
- Keep the required `final_verify` step last: it runs the full project check and confirms that every point of the requirement is implemented.
