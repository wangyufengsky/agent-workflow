import { z } from 'zod';
import {
  diffSchema,
  fileDiffSchema,
  gitBranchSchema,
  gitCommitDetailSchema,
  gitCommitSchema,
  gitFileSchema,
  gitStatusSchema,
  gitTreeEntrySchema,
  gitWorktreeSchema,
} from '../contracts/api/git.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// The Git console (11 §8, pro mode): reading the project repository, fetching, and the worktree overview.

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
  }),
  output: z.object({ items: z.array(gitCommitSchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/log' },
});

export const gitCommitOp = defineOperationContract({
  ...common,
  id: 'git.commit',
  title: 'op.git.commit',
  description: 'One commit with the files it changed against its first parent',
  input: z.object({ id: z.string(), sha: ref }),
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
