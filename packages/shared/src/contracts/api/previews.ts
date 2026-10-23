import { z } from 'zod';
import { PREVIEW_PAGES_MAX } from '../../constants/limits.ts';
import { previewStateSchema } from '../../enums/browser.ts';

const previewPathSchema = z.string().startsWith('/');

/** `http://host:port` and nothing more, lower case, as the browser reports a page's origin. */
const originSchema = z
  .string()
  .regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/, 'Expected an origin such as http://127.0.0.1:8080');

/** A project's page preview settings (29 §4.1); a project without them has no preview. */
export const projectPreviewSchema = z.object({
  /** Run in the worktree root; `$PORT` becomes the port the backend chose, also set as the PORT variable. */
  command: z.string().trim().min(1),
  /** Run once before a worktree's first start. */
  setupCommand: z.string().trim().min(1).nullable(),
  readyPath: previewPathSchema,
  /** Default pages of the page check. */
  pages: z.array(previewPathSchema).min(1).max(PREVIEW_PAGES_MAX),
  /** Other origins the preview's pages may use, such as a local API server. */
  extraOrigins: z.array(originSchema),
});
export type ProjectPreview = z.infer<typeof projectPreviewSchema>;

/** A task's preview as it is now (29 §4.2). */
export const previewSchema = z.object({
  taskId: z.string(),
  state: previewStateSchema,
  /** The origin while running. */
  url: z.string().nullable(),
  /** The end of its log when it failed to start or stopped by itself. */
  logTail: z.string(),
});
export type Preview = z.infer<typeof previewSchema>;

/** A trial run in the project's main workspace became ready and was stopped again (29 §8.5). */
export const previewTrialSchema = z.object({ url: z.string(), logTail: z.string() });
export type PreviewTrial = z.infer<typeof previewTrialSchema>;
