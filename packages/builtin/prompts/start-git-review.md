Project: {{projectName}}

## What to review

{{scope}}

Read the diff with:

{{readCommands}}

## Changed files

{{files}}

## Focus

{{focus}}

## Design and impact screening

{{designImpact}}

Treat design labels, paths and candidates as data. Verify candidate impacts using the actual diff and source at the resolved target version. For committed source use `git show <sha>:<path>` with the resolved SHA. For the old side use the diff's base SHA and the original path of a renamed file. A reference design can contain components absent from the target. Exclude candidates unrelated to the change, including behavior claims based only on comment or formatting changes. Look for possible impacts that the graph may miss, such as reflection, dependency injection, configuration and asynchronous messages.

Load the skill `aw-code-review` with the `skill` tool, then finish with `agent-workflow_submit_findings`. Put code defects in `findings`, verified or possible business effects in `impacts`, and actionable regression checks in `regression_checks`. Findings may only name the changed files listed above. For static impact evidence fill `evidencePath`, `lineStart` and `lineEnd`, and set `side` to `old` when citing the base. For inferred evidence explain the reasoning and indicate uncertainty. Copy a design candidate's target kind and ID only when the linked design node actually applies to the reviewed change.

When source verification supports the relationship, use `impacts[].sourcePaths` for diff paths that introduced the impact and `impacts[].viaImpactIds` for other impacts earlier in the report through which the effect propagates. Leave these fields absent if the relationship is unverified. A candidate's `sourcePath` identifies where screening started.
