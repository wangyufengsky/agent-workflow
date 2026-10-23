import { z } from 'zod';
import { hostingProviderSchema } from '../../enums/git.ts';
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
