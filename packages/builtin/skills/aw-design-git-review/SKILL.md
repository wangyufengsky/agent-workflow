---
name: aw-design-git-review
description: Use when the user asks whether a project design is stale, what changing a file or symbol could affect, or for a Git review or comparison of two versions.
---

# Project design and Git review

Resolve the project from the conversation or current page, or use `agent-workflow-app_projects_list` to find it by name. To find its design, call `agent-workflow-app_designs_list({projectId})`. Prefer the design the user named or opened. For impact lookup, use a design with completed sections. Ask which design to use if the choice of baseline is ambiguous. The design and Git review tools are available in pro mode.

## Check design freshness

1. Call `agent-workflow-app_designs_staleness({id})`. Report whether the design is fresh, stale, or of unknown freshness. If stale, report `changedFilesCount` and name the affected sections. Use `agent-workflow-app_designs_get({id})` to resolve titles from `affectedSectionIds` if necessary.
2. For an explicit request to update the design, call `agent-workflow-app_designs_incrementalUpdate({id, sectionIds})` with the affected sections the user wants updated, then follow the assistant protocol for confirmation. A freshness inquiry ends with the read-only report.

## Look up potential impact

1. Use project-relative file paths. For a symbol, use source evidence from `agent-workflow-app_designs_get({id})` to resolve its file. Ask for the path if the evidence does not uniquely identify it.
2. Call `agent-workflow-app_designs_lookupImpact({id, paths})`. Report directly and indirectly related modules and transactions with the returned `sourcePath`. State the snapshot commit and whether there were uncommitted changes at scan time (`snapshotSha`, `dirty`), completed and total sections (`coverage`), uncovered paths and truncation. State that the baseline is unknown if there is no snapshot commit.
3. Present the result as static screening from the design snapshot. Use the freshness check when the user needs to know if the snapshot still represents the current worktree. When there is no usable design, no match, or an uncovered path, explain what remains unverified.

## Start a Git review or two-version comparison

1. For an explicit review or comparison request, call `agent-workflow-app_gitReviews_start({id, target})`, where `id` is the project ID. Use `{kind: "worktree"}` for uncommitted changes, `{kind: "commit", sha}` for one commit, and `{kind: "branch", branch}` for a branch. Use `{kind: "range", from, to}` to review changes introduced since the merge base, or `{kind: "compare", from, to}` to compare the two endpoints directly. Follow the assistant protocol for confirmation.
2. Read the status and report with `agent-workflow-app_gitReviews_get({reviewId})`. If it is running, direct the user to the navigation card for progress and read it again on follow-up. When it completes, give the actual scope, key code findings, business impacts and regression checks. Include the design match and relevant coverage limits. If it fails, report the reason returned by the tool.
3. Suggest a follow-up only when it serves the user's goal, such as fixing a finding, preparing a release review deck, or updating the design after merge. The user manages finding disposition in the Git workbench.
