import { z } from 'zod';
import { viewportPresetSchema } from '../../enums/browser.ts';

/** `POST /browser/login-tabs` (29 §8.6): a tab the user logs in to a website in. */
export const openLoginTabRequestSchema = z.object({
  url: z.string().regex(/^https?:\/\/\S+$/i, 'Expected an http(s) address'),
});
export const userTabSchema = z.object({ tabId: z.string() });
export type UserTab = z.infer<typeof userTabSchema>;

/** Hosts with cookies in the websites' login partition. */
export const siteLoginsSchema = z.object({ hosts: z.array(z.string()) });
export type SiteLogins = z.infer<typeof siteLoginsSchema>;

/** What an AI action left on the page (29 §5.7, §8.2): a thumbnail beside the attempt's transcript. */
export const browserFrameSchema = z.object({
  attemptId: z.string(),
  taskId: z.string().nullable(),
  /** From 1 within the attempt. */
  seq: z.number().int(),
  /** The browser tool that acted, such as `browser_click`. */
  tool: z.string(),
  url: z.string(),
  /** Read with `GET /attempts/:attemptId/browser/:file`. */
  file: z.string(),
});
export type BrowserFrame = z.infer<typeof browserFrameSchema>;

/** `POST /tasks/:taskId/preview/tabs` (29 §8.1): the user's own tab on the task's preview. */
export const openUserTabRequestSchema = z.object({ taskId: z.string() });
export const navigateUserTabRequestSchema = z.object({
  tabId: z.string(),
  path: z.string().startsWith('/'),
});
export const setUserViewportRequestSchema = z.object({ tabId: z.string(), preset: viewportPresetSchema });
