---
name: aw-backend-development
description: Use when the step implements or designs tests for a backend API, migration, service, job or interface used by another step. Check the contract and existing callers, verify affected failure paths and existing data, and hand confirmed interface details to dependent steps.
---

# Backend development and interface handoff

1. Start with the task context and accepted upstream handoffs. Identify the current entry point, callers, request and response shape, error semantics and data the change touches. Treat the project's existing contract and conventions as the baseline. Use `agent-workflow_get_node_output` for a specific upstream result when its evidence or details are needed.
2. Implement at the normal entry point and update affected callers or fixtures. Preserve behavior relied on by existing callers. For schema changes, exercise the migration with representative data created before the change. Where an operation writes state and can be retried or interrupted, define what happens on duplicate requests and partial failure, then verify that behavior with the project's tests.
3. Run the step's checks against the entry point. Cover a normal case and any materially affected validation, authorization, compatibility or failure path. Use the project's actual database fixtures or migration tests when the change depends on stored data. Record which commands ran, their outcomes, and checks still pending.
4. When another step needs the result, use `handoff` on `agent-workflow_submit_result`. Give concise `facts` with `text` and `evidence` for the interface, payload or status codes that the caller can rely on; `decisions` for compatibility constraints; and `openQuestions` for unresolved assumptions. Cite the relevant contract or passing check. Leave transaction and migration details in the repository when downstream steps only need the behavior.
