---
name: aw-merge-conflicts
description: Use when your step is to resolve git merge conflicts in the task's worktree (files with <<<<<<< markers after the app ran git merge). How to find out what each side intended, merge both, and handle lockfiles, generated files, migrations, moved or deleted code and tests.
---

# Resolving merge conflicts

The app has already run `git merge` in this worktree and left the conflict markers; it commits the merge when your step is accepted. Read-only git is fine (`git status`, `git log`, `git show`, `git diff`); never run git commands that write, such as `add`, `commit`, `merge --abort`, `checkout --ours` / `--theirs`, `restore`, `reset`.

## Steps

1. List the conflicted files: `git diff --name-only --diff-filter=U`.
2. For each file, find out what each side wanted **before** you edit it:
   - `git log --oneline --left-right HEAD...MERGE_HEAD -- <file>`: commits of this task's side (`<`) and of the incoming side (`>`); read their messages and `git show <commit> -- <file>`.
   - The three versions: `git show :1:<file>` (the common base), `:2:<file>` (this task), `:3:<file>` (incoming).
3. Merge the intent, not the text. Keep both changes where they are independent. Where both touch the same logic, write the version that does what both wanted. Where they truly contradict, keep the incoming behaviour unless the requirement says otherwise, and say so in your result.
4. Remove every marker; check with `git grep -n -e '^<<<<<<< ' -e '^>>>>>>> ' -e '^=======$'`.
5. Run the project's check and fix what the merge broke: imports, renamed functions, changed signatures that the other side's new code still calls.

## Cases

- **Lockfiles** (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `go.sum`, `poetry.lock`): do not merge them by hand. Merge the manifest (`package.json`, `go.mod` …), then regenerate the lockfile with the project's package manager (for example `pnpm install --lockfile-only`). When that cannot run (no network, see the skill `aw-offline-network` if you have it), keep the incoming lockfile and write in your result that it must be regenerated.
- **Generated files** (build output, generated code, API clients): regenerate them with the project's own command instead of merging. Snapshot files: merge the source first, then update the snapshots only for the tests whose expected output really changed.
- **Both sides added an entry** (database migrations with the same number, enum values, routes, translation keys, changelog lines): keep both. Renumber this task's migration to come after the incoming one, never one that is already on the target branch, and check that ids and keys stay unique.
- **Moved or renamed on one side, changed on the other**: carry the change to the new place (`git log --follow -- <path>`, `git diff -M`), and delete the old copy if git left one.
- **Deleted on one side, changed on the other**: find out why it was deleted (the commit message). Re-apply the change where the code went, or drop it when the feature was removed on purpose; say which.
- **Tests**: keep both sides' tests and make them pass with the merged code. Never delete or weaken a test to settle a conflict.

## In your result

List the conflicted files. For each one that was not trivial, say what you kept from each side, and name anything you could not regenerate or verify.
