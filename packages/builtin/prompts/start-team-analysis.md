Project: {{projectName}}

## Whose work

{{memberName}} ({{emails}}), the commits on branch `{{ref}}` authored from {{from}} to {{to}}.

## Figures the app counted

{{figures}}

## Commits in the period

Newest first: full SHA, date, counted lines (+added −deleted), subject. Read any of them with `git show <sha>`.

{{commits}}

## Sampled commits to review

{{sample}}

## What to do

1. Read the commits, enough to say what this person worked on. Group them into a few pieces of work.
2. Review each sampled commit with `git show <sha>` and report the real problems in it, as you would in a review.
3. Finish with `agent-workflow_submit_member_analysis`: a short overview, the pieces of work, what was done well and what deserves attention — each with the commits it rests on — and the findings of the sampled commits.

Write only what the commits show. No scores, grades or rankings; no guesses about character, attitude, effort or working hours. A commit can be counted in the app's figures without being worth a remark.
