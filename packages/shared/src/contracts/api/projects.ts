import { z } from 'zod';
import { hostingProviderSchema, hostingSourceSchema } from '../../enums/git.ts';
import { projectPreviewSchema } from './previews.ts';

export const hostingRefSchema = z.object({
  provider: hostingProviderSchema,
  /** Self-hosted GitLab address; null for github.com / gitlab.com. */
  baseUrl: z.string().nullable(),
  /** `owner/name` (GitHub) or the project path (GitLab). */
  repo: z.string(),
});
export type HostingRef = z.infer<typeof hostingRefSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  repoPath: z.string(),
  defaultBranch: z.string(),
  /** `$PROJECT_CHECK` in acceptance checks (13 §1); null when the project has none. */
  checkCommand: z.string().nullable(),
  /** Bound remote (M4-05); only whether a token is stored is exposed. */
  hosting: hostingRefSchema.extend({ hasToken: z.boolean() }).nullable(),
  /** Page preview settings (29 §4.1); null when the project has no preview. */
  preview: projectPreviewSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ProjectDTO = z.infer<typeof projectSchema>;

export const projectDetailSchema = projectSchema.extend({
  /** Parsed from `git remote get-url origin`, used to prefill the hosting form; null when not recognisable. */
  inferredHosting: hostingRefSchema.nullable(),
  /**
   * The repository PRs and token pushes go to, and whose token signs in (D155): the project's own binding with a
   * token, else origin's repository with the global token of its platform; null when neither applies.
   */
  effectiveHosting: hostingRefSchema.extend({ source: hostingSourceSchema }).nullable(),
  /** Database connections the project's AI sessions may query (M5-07). */
  dbConnectionIds: z.array(z.string()),
  /** Bash patterns the user always allowed for the project's AI sessions, oldest first (D101). */
  allowedBash: z.array(z.string()),
});
export type ProjectDetailDTO = z.infer<typeof projectDetailSchema>;

export const createProjectRequestSchema = z.object({
  /** Absolute path of the repository root. */
  repoPath: z.string().min(1),
  name: z.string().trim().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** What putting a directory that is in no Git repository under Git would do (D153, 11 §3). */
export const gitInitPreviewSchema = z.object({
  /** Files the first commit takes: everything not ignored, the `.gitignore` to be written included. */
  files: z.number().int(),
  bytes: z.number().int(),
  /** Files of at least `GIT_INIT_LARGE_FILE_BYTES`, largest first, at most `GIT_INIT_LARGE_FILES_SHOWN`. */
  largeFiles: z.array(z.object({ path: z.string(), bytes: z.number().int() })),
  largeFileCount: z.number().int(),
  /** The `.gitignore` to be written; null when the directory has one, which is kept as it is. */
  gitignore: z.string().nullable(),
});
export type GitInitPreviewDTO = z.infer<typeof gitInitPreviewSchema>;

export const updateProjectRequestSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
  checkCommand: z.string().trim().min(1).nullable().optional(),
  preview: projectPreviewSchema.nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** `PUT /projects/:id/hosting`: the token is verified with the platform before it is stored (11 §3). */
export const setHostingRequestSchema = z.object({
  id: z.string(),
  provider: hostingProviderSchema,
  /** Self-hosted GitLab address; omit for github.com and gitlab.com. */
  baseUrl: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .optional(),
  repo: z
    .string()
    .trim()
    .regex(/^[^/\s]+(\/[^/\s]+)+$/),
  token: z.string().trim().min(1),
});
export type SetHostingRequest = z.infer<typeof setHostingRequestSchema>;

/** A global GitHub / GitLab token (D155), used by projects that have none of their own. */
export const hostingAccountSchema = z.object({
  id: z.string(),
  provider: hostingProviderSchema,
  /** Self-hosted GitLab address; null for github.com and gitlab.com. */
  baseUrl: z.string().nullable(),
  /** The user name the token signs in as, read when it was saved. */
  account: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type HostingAccountDTO = z.infer<typeof hostingAccountSchema>;

export const setHostingAccountRequestSchema = z.object({
  provider: hostingProviderSchema,
  /** Self-hosted GitLab address; omit for github.com and gitlab.com. */
  baseUrl: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .optional(),
  token: z.string().trim().min(1),
});
export type SetHostingAccountRequest = z.infer<typeof setHostingAccountRequestSchema>;
