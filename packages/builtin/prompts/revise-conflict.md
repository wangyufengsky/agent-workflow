Merging this task's branch into `{{targetBranch}}` conflicts. The backend has already run `git merge {{targetBranch}}` in this worktree; these files still contain conflict markers:

{{files}}

Load the skill `aw-merge-conflicts` with the `skill` tool first, then resolve every conflict so that both this task's changes and the changes on `{{targetBranch}}` are kept, remove all conflict markers and run the checks. Do not run git commands: the backend commits the merge when this step is done.
