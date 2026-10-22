import { z } from 'zod';
import {
  COMMIT_MESSAGE_MAX_CHARS,
  GIT_REVIEW_FINDING_TEXT_MAX_CHARS,
  GIT_REVIEW_FINDING_TITLE_MAX_CHARS,
  GIT_REVIEW_FINDINGS_MAX,
  GIT_REVIEW_FOCUS_MAX_CHARS,
  GIT_REVIEW_SUMMARY_MAX_CHARS,
} from '../../constants/limits.ts';
import {
  diffSideSchema,
  findingCategorySchema,
  findingSeveritySchema,
  gitMergeStrategySchema,
  gitOperationSchema,
  gitReviewTargetSchema,
} from '../../enums/git.ts';
import { attemptStatusSchema, taskStatusSchema } from '../../enums/task.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
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
  /** An operation the user left unfinished (27 §5); the workbench's write operations wait for it. */
  operation: gitOperationSchema.nullable(),
  /** Who commits made here are by (`user.name` / `user.email`); null when git has no identity. */
  identity: z.object({ name: z.string(), email: z.string() }).nullable(),
  /** When any remote was last fetched (`FETCH_HEAD`), milliseconds; null if never. */
  fetchedAt: z.number().nullable(),
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

/**
 * A commit with the files it changed against `base`: the chosen parent (the first by default), or the empty tree for
 * a root commit; and the local branches that contain it.
 */
export const gitCommitDetailSchema = gitCommitSchema.extend({
  committerName: z.string(),
  committerEmail: z.string(),
  committedAt: z.number(),
  base: z.string(),
  files: z.array(diffFileSchema),
  branches: z.array(z.string()),
});
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

/**
 * `GET /projects/:id/git/changes`: the main worktree's uncommitted changes; untracked files are unstaged additions,
 * paths a conflict left unmerged are listed apart.
 */
export const gitChangesSchema = z.object({
  staged: z.array(diffFileSchema),
  unstaged: z.array(diffFileSchema),
  conflicted: z.array(z.string()),
});
export type GitChangesDTO = z.infer<typeof gitChangesSchema>;

export const commitMessageSchema = z.string().trim().min(1).max(COMMIT_MESSAGE_MAX_CHARS);

/** `POST /projects/:id/git/merge` (27 §3.5): merged, or stopped on conflicts with the target unchanged. */
export const gitMergeRequestSchema = z.object({
  id: z.string(),
  source: z.string().min(1),
  target: z.string().min(1),
  strategy: gitMergeStrategySchema,
  message: commitMessageSchema,
});
export type GitMergeRequest = z.infer<typeof gitMergeRequestSchema>;
export const gitMergeResultSchema = z.union([
  z.object({ merged: z.literal(true), commit: z.string() }),
  z.object({ merged: z.literal(false), conflictFiles: z.array(z.string()) }),
]);
export type GitMergeResultDTO = z.infer<typeof gitMergeResultSchema>;

/** What a push would send: the branch, its remote branch and the commits it lacks (newest first). */
export const gitPushPreviewSchema = z.object({
  branch: z.string(),
  remoteBranch: z.string(),
  /** The remote branch does not exist yet. */
  isNew: z.boolean(),
  commits: z.array(gitCommitSchema),
  /** All commits to push; `commits` lists at most GIT_PUSH_COMMITS_SHOWN. */
  total: z.number(),
});
export type GitPushPreviewDTO = z.infer<typeof gitPushPreviewSchema>;

/** A finding of an AI review (27 §4.4). */
export const gitFindingSchema = z.object({
  severity: findingSeveritySchema,
  category: findingCategorySchema,
  path: z.string().min(1),
  line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  side: diffSideSchema.optional(),
  title: z.string().min(1).max(GIT_REVIEW_FINDING_TITLE_MAX_CHARS),
  description: z.string().min(1).max(GIT_REVIEW_FINDING_TEXT_MAX_CHARS),
  suggestion: z.string().min(1).max(GIT_REVIEW_FINDING_TEXT_MAX_CHARS).optional(),
});
export type GitFindingDTO = z.infer<typeof gitFindingSchema>;

/** What `gitReviews.start` reviews (27 §4.2). */
export const gitReviewTargetInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('worktree') }),
  z.object({ kind: z.literal('commit'), sha: z.string().min(1), parent: z.number().int().min(1).optional() }),
  z.object({ kind: z.literal('branch'), branch: z.string().min(1) }),
  z.object({ kind: z.literal('range'), from: z.string().min(1), to: z.string().min(1) }),
]);
export type GitReviewTargetInput = z.infer<typeof gitReviewTargetInputSchema>;

export const gitReviewFocusSchema = z.string().trim().min(1).max(GIT_REVIEW_FOCUS_MAX_CHARS);

/** An AI review; its status is its attempt's (27 §7.2). */
export const gitReviewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  target: gitReviewTargetSchema,
  /** A branch name or a short SHA, for display. */
  label: z.string(),
  /** The diff reviewed: `from` → `to`; `to` null for the worktree's uncommitted changes. */
  from: z.string(),
  to: z.string().nullable(),
  /** For a commit: the parent (1-based) it was compared with; null for other targets. */
  parent: z.number().nullable(),
  focus: z.string().nullable(),
  files: z.array(diffFileSchema),
  status: attemptStatusSchema,
  model: z.string().nullable(),
  error: errorInfoSchema.nullable(),
  summary: z.string().nullable(),
  findings: z.array(gitFindingSchema),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type GitReviewDTO = z.infer<typeof gitReviewSchema>;

/** `submit_findings` (27 §4.4). */
export const submitFindingsInputSchema = z.object({
  summary: z.string().min(1).max(GIT_REVIEW_SUMMARY_MAX_CHARS).describe('The conclusion, Markdown'),
  findings: z.array(gitFindingSchema).max(GIT_REVIEW_FINDINGS_MAX),
});
export type SubmitFindingsInput = z.infer<typeof submitFindingsInputSchema>;

/** `submit_commit_message` (27 §7.3). */
export const submitCommitMessageInputSchema = z.object({
  subject: z.string().trim().min(1).max(200).describe("One line, in the style of the repository's recent commits"),
  body: z.string().trim().max(COMMIT_MESSAGE_MAX_CHARS).optional().describe('Optional; wrapped Markdown-free text'),
});
export type SubmitCommitMessageInput = z.infer<typeof submitCommitMessageInputSchema>;
