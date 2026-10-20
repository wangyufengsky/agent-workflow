import { z } from 'zod';
import { taskStatusSchema } from '../../enums/task.ts';
import { diffFileSchema } from '../mcp/get-task-diff.ts';

/** The task a branch or worktree belongs to (Git console, 11 §8). */
export const gitTaskRefSchema = z.object({ id: z.string(), key: z.string(), status: taskStatusSchema });

/** `GET /projects/:id/git/status`: the main worktree. */
export const gitStatusSchema = z.object({
  /** Null when HEAD is detached. */
  branch: z.string().nullable(),
  /** Null before the first commit. */
  commit: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  clean: z.boolean(),
  /** Changed, unmerged and untracked paths with their two-letter porcelain code (`.M`, `R.`, `UU`, `??`). */
  files: z.array(z.object({ path: z.string(), code: z.string() })),
});
export type GitStatusDTO = z.infer<typeof gitStatusSchema>;

export const gitBranchSchema = z.object({
  /** Short name: `main`, `origin/main`. */
  name: z.string(),
  remote: z.boolean(),
  commit: z.string(),
  /** Checked out in the main worktree. */
  current: z.boolean(),
  upstream: z.string().nullable(),
  /** Against the upstream; 0 without one. */
  ahead: z.number(),
  behind: z.number(),
  subject: z.string(),
  committedAt: z.number(),
  task: gitTaskRefSchema.nullable(),
});
export type GitBranchDTO = z.infer<typeof gitBranchSchema>;

export const gitCommitSchema = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.number(),
  subject: z.string(),
  body: z.string(),
});
export type GitCommitDTO = z.infer<typeof gitCommitSchema>;

/** A commit with the files it changed against its first parent (the empty tree for a root commit). */
export const gitCommitDetailSchema = gitCommitSchema.extend({ files: z.array(diffFileSchema) });
export type GitCommitDetailDTO = z.infer<typeof gitCommitDetailSchema>;

export const GitTreeEntryType = {
  Tree: 'tree',
  Blob: 'blob',
  /** A submodule. */
  Commit: 'commit',
} as const;
export type GitTreeEntryType = (typeof GitTreeEntryType)[keyof typeof GitTreeEntryType];

export const gitTreeEntrySchema = z.object({
  name: z.string(),
  /** From the repository root. */
  path: z.string(),
  type: z.enum(GitTreeEntryType),
  /** Bytes; null for directories and submodules. */
  size: z.number().nullable(),
});
export type GitTreeEntryDTO = z.infer<typeof gitTreeEntrySchema>;

/** File content at a ref; large and binary files are not sent. */
export const gitFileSchema = z.union([
  z.object({ path: z.string(), content: z.string() }),
  z.object({ path: z.string(), tooLarge: z.literal(true), size: z.number() }),
  z.object({ path: z.string(), binary: z.literal(true) }),
]);
export type GitFileDTO = z.infer<typeof gitFileSchema>;

/** Unified diff of one file; over `DIFF_FILE_MAX_BYTES` only the size is sent. */
export const fileDiffSchema = z.union([
  z.object({ path: z.string(), diff: z.string() }),
  z.object({ path: z.string(), tooLarge: z.literal(true), size: z.number() }),
]);
export type FileDiffDTO = z.infer<typeof fileDiffSchema>;

/** Changed files of a task or node and the commit they are compared with (null: a node that committed nothing). */
export const diffSchema = z.object({ base: z.string().nullable(), files: z.array(diffFileSchema) });
export type DiffDTO = z.infer<typeof diffSchema>;

/** `GET /projects/:id/worktrees`: every worktree of the repository, ours (`managed`) or not. */
export const gitWorktreeSchema = z.object({
  path: z.string(),
  /** The repository's main worktree. */
  main: z.boolean(),
  /** Null when detached. */
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  locked: z.boolean(),
  /** Its directory is gone; `git worktree prune` removes it. */
  prunable: z.boolean(),
  /** Uncommitted changes; null when the directory is gone. */
  dirty: z.boolean().nullable(),
  /** Against the project's default branch; null when detached or missing. */
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  /** Created by agent-workflow for a task. */
  managed: z.boolean(),
  task: gitTaskRefSchema.nullable(),
});
export type GitWorktreeDTO = z.infer<typeof gitWorktreeSchema>;
