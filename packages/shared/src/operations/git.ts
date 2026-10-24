import { z } from 'zod';
import {
  commitMessageSchema,
  diffSchema,
  fileDiffSchema,
  gitBranchSchema,
  gitChangesSchema,
  gitCommitDetailSchema,
  gitCommitSchema,
  gitFileSchema,
  gitMergeRequestSchema,
  gitMergeResultSchema,
  gitPushPreviewSchema,
  gitStatusSchema,
  gitTreeEntrySchema,
  gitWorktreeSchema,
} from '../contracts/api/git.ts';
import { taskDetailSchema } from '../contracts/api/tasks.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// The Git workbench (11 §8, 27, pro mode): reading the project repository, the user's own Git operations in its main
// worktree (D108), and the worktree overview.

const byProject = z.object({ id: z.string() });
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Pro } as const;
const ref = z.string().min(1);

export const gitStatusOp = defineOperationContract({
  ...common,
  id: 'git.status',
  title: 'op.git.status',
  description: 'Branch, upstream distance and uncommitted changes of the project main worktree',
  input: byProject,
  output: gitStatusSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/status' },
});

export const gitBranchesOp = defineOperationContract({
  ...common,
  id: 'git.branches',
  title: 'op.git.branches',
  description: 'Local and remote-tracking branches of the project, with the tasks they belong to',
  input: byProject,
  output: z.object({ items: z.array(gitBranchSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/branches' },
});

export const gitLogOp = defineOperationContract({
  ...common,
  id: 'git.log',
  title: 'op.git.log',
  description: 'Commits reachable from a ref, newest first; pass nextCursor back as cursor for the next page',
  input: z.object({
    id: z.string(),
    ref,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().regex(/^\d+$/).optional(),
    /** Only commits whose author name or email contains this. */
    author: z.string().min(1).optional(),
    /** Only commits whose message contains this, or whose SHA starts with it. */
    search: z.string().min(1).optional(),
    /**
     * Only the ref's own (first-parent) history committed before this time (ms): with `limit: 1`, the commit the
     * branch was at then, the start of a review by date (27 §4.2).
     */
    before: z.coerce.number().int().optional(),
  }),
  output: z.object({ items: z.array(gitCommitSchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/log' },
});

export const gitCommitOp = defineOperationContract({
  ...common,
  id: 'git.commit',
  title: 'op.git.commit',
  description: 'One commit with the files it changed against a parent (the first unless `parent` says otherwise)',
  input: z.object({ id: z.string(), sha: ref, parent: z.coerce.number().int().min(1).optional() }),
  output: gitCommitDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/commits/:sha' },
});

export const gitDiffOp = defineOperationContract({
  ...common,
  id: 'git.diff',
  title: 'op.git.diff',
  description: 'Files changed between two refs',
  input: z.object({ id: z.string(), from: ref, to: ref }),
  output: diffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/diff' },
});

export const gitDiffFileOp = defineOperationContract({
  ...common,
  id: 'git.diffFile',
  title: 'op.git.diffFile',
  description: 'Unified diff of one file between two refs',
  input: z.object({ id: z.string(), from: ref, to: ref, path: z.string().min(1) }),
  output: fileDiffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/diff/file' },
});

export const gitTreeOp = defineOperationContract({
  ...common,
  id: 'git.tree',
  title: 'op.git.tree',
  description: 'Entries of a directory at a ref (path empty for the repository root)',
  input: z.object({ id: z.string(), ref, path: z.string().default('') }),
  output: z.object({ items: z.array(gitTreeEntrySchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/tree' },
});

export const gitFileOp = defineOperationContract({
  ...common,
  id: 'git.file',
  title: 'op.git.file',
  description: 'Content of a text file at a ref',
  input: z.object({ id: z.string(), ref, path: z.string().min(1) }),
  output: gitFileSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/file' },
});

export const gitFetchOp = defineOperationContract({
  ...common,
  id: 'git.fetch',
  refs: { id: InputRef.Project },
  title: 'op.git.fetch',
  description: 'Fetch every remote of the project and prune deleted remote branches',
  input: byProject,
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/fetch' },
});

export const listWorktreesOp = defineOperationContract({
  ...common,
  id: 'worktrees.list',
  title: 'op.worktrees.list',
  description: 'Every worktree of the project repository, marking those agent-workflow created for tasks',
  input: byProject,
  output: z.object({ items: z.array(gitWorktreeSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/worktrees' },
});

export const pruneWorktreesOp = defineOperationContract({
  ...common,
  id: 'worktrees.prune',
  refs: { id: InputRef.Project },
  title: 'op.worktrees.prune',
  description:
    'Remove worktrees left behind by finished or cancelled tasks (their branches are kept) and prune stale entries',
  input: byProject,
  output: z.object({ items: z.array(gitWorktreeSchema) }),
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/projects/:id/worktrees/prune' },
});

const paths = z.array(z.string().min(1)).min(1);
/** A flag of a DELETE request: a query string over HTTP, a boolean from the assistant. */
const queryFlag = z.union([z.boolean(), z.stringbool()]).default(false);
const branch = z.string().min(1);

export const gitChangesOp = defineOperationContract({
  ...common,
  id: 'git.changes',
  title: 'op.git.changes',
  description: 'Staged and unstaged changes of the main worktree; untracked files are unstaged additions',
  input: byProject,
  output: gitChangesSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/changes' },
});

export const gitChangeFileOp = defineOperationContract({
  ...common,
  id: 'git.changeFile',
  title: 'op.git.changeFile',
  description: 'Unified diff of one changed file: staged (index against HEAD) or unstaged (worktree against index)',
  input: z.object({ id: z.string(), path: z.string().min(1), side: z.enum(['staged', 'unstaged']) }),
  output: fileDiffSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/changes/file' },
});

export const gitStageOp = defineOperationContract({
  ...common,
  id: 'git.stage',
  refs: { id: InputRef.Project },
  title: 'op.git.stage',
  description: 'Stage whole files of the main worktree (git add)',
  input: z.object({ id: z.string(), paths }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/stage' },
});

export const gitUnstageOp = defineOperationContract({
  ...common,
  id: 'git.unstage',
  refs: { id: InputRef.Project },
  title: 'op.git.unstage',
  description: 'Unstage whole files, keeping their changes in the worktree',
  input: z.object({ id: z.string(), paths }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/unstage' },
});

export const gitCreateCommitOp = defineOperationContract({
  ...common,
  id: 'git.createCommit',
  refs: { id: InputRef.Project },
  title: 'op.git.createCommit',
  description: "Commit the staged changes of the main worktree as the user (the user's git identity and hooks)",
  input: z.object({ id: z.string(), message: commitMessageSchema }),
  output: gitCommitSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/commits', status: 201 },
});

export const gitDraftCommitMessageOp = defineOperationContract({
  ...common,
  expose: { palette: false, assistant: false },
  id: 'git.draftCommitMessage',
  title: 'op.git.draftCommitMessage',
  description: 'Let the AI draft a commit message for the staged changes, or for merging `from` into `to`',
  input: z
    .object({ id: z.string(), from: ref.optional(), to: ref.optional() })
    .refine((input) => (input.from === undefined) === (input.to === undefined), {
      path: ['to'],
      message: 'from and to go together',
    }),
  output: z.object({ subject: z.string(), body: z.string() }),
  risk: OperationRisk.Read,
  http: { method: 'POST', path: '/projects/:id/git/commit-message' },
});

export const gitPushPreviewOp = defineOperationContract({
  ...common,
  id: 'git.pushPreview',
  title: 'op.git.pushPreview',
  description: 'What pushing a local branch to origin would send',
  input: z.object({ id: z.string(), branch }),
  output: gitPushPreviewSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/push' },
});

export const gitPushOp = defineOperationContract({
  ...common,
  id: 'git.push',
  refs: { id: InputRef.Project },
  title: 'op.git.push',
  description: 'Push a local branch to origin under the same name, never forced; sets the upstream when it has none',
  input: z.object({ id: z.string(), branch }),
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/projects/:id/git/push' },
});

export const gitPullOp = defineOperationContract({
  ...common,
  id: 'git.pull',
  refs: { id: InputRef.Project },
  title: 'op.git.pull',
  description: 'Fetch the upstream of the checked-out branch and fast-forward to it; never merges',
  input: byProject,
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/pull' },
});

export const gitCreateBranchOp = defineOperationContract({
  ...common,
  id: 'git.createBranch',
  refs: { id: InputRef.Project },
  title: 'op.git.createBranch',
  description: 'Create a local branch at a ref, optionally switching the main worktree to it',
  input: z.object({ id: z.string(), name: branch, startPoint: ref, switch: z.boolean().default(false) }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/branches' },
});

export const gitSwitchBranchOp = defineOperationContract({
  ...common,
  id: 'git.switchBranch',
  refs: { id: InputRef.Project },
  title: 'op.git.switchBranch',
  description:
    'Check out a branch in the main worktree (a remote branch becomes a local tracking branch); the worktree must be clean',
  input: z.object({ id: z.string(), branch }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/switch' },
});

export const gitDeleteBranchOp = defineOperationContract({
  ...common,
  id: 'git.deleteBranch',
  refs: { id: InputRef.Project },
  title: 'op.git.deleteBranch',
  description: 'Delete a local branch; an unmerged one only with force (its commits may be lost)',
  input: z.object({ id: z.string(), name: branch, force: queryFlag }),
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/projects/:id/git/branches/:name' },
});

export const gitMergeOp = defineOperationContract({
  ...common,
  id: 'git.merge',
  refs: { id: InputRef.Project },
  title: 'op.git.merge',
  description:
    'Merge a branch or commit into a local branch as the user (merge commit or squash); on conflicts nothing changes',
  input: gitMergeRequestSchema,
  output: gitMergeResultSchema,
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/projects/:id/git/merge' },
});

export const gitMergeWithAiOp = defineOperationContract({
  ...common,
  id: 'git.mergeWithAi',
  refs: { id: InputRef.Project },
  title: 'op.git.mergeWithAi',
  description:
    'Start a task that merges source into target and lets the AI resolve the conflicts in its own worktree; the user merges the result',
  input: z.object({ id: z.string(), source: branch, target: branch }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/git/merge-task', status: 201 },
  produces: { kind: EntityKind.Task, ref: (task) => ({ id: task.id, title: `${task.key} · ${task.title}` }) },
});

export const gitCreatePullRequestOp = defineOperationContract({
  ...common,
  id: 'git.createPullRequest',
  refs: { id: InputRef.Project },
  title: 'op.git.createPullRequest',
  description: "Open a pull / merge request from a pushed branch; returns the branch's open one if it has one",
  input: z.object({
    id: z.string(),
    branch,
    base: branch,
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20_000).default(''),
  }),
  output: z.object({ url: z.string(), existed: z.boolean() }),
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/projects/:id/git/pull-requests', status: 201 },
});
