import { z } from 'zod';
import { viewportPresetSchema } from '../../enums/browser.ts';
import { attemptKindSchema, attemptStatusSchema } from '../../enums/task.ts';
import { browserLogsOutputSchema, browserPageSchema } from '../mcp/browser.ts';

/** 助手只读网页：沿用网站登录状态，但不开放页面操作。 */
export const readWebsiteRequestSchema = z.object({
  url: z
    .url({ protocol: /^https?$/ })
    .refine((url) => !/^https?:\/\/[^/?#]*@/i.test(url), 'URL credentials are not accepted; use the website login'),
});
export const readWebsiteSchema = browserPageSchema.extend({
  settled: z.boolean(),
  logs: browserLogsOutputSchema,
});

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

/** The user's preview tab as the bottom bar shows it (29 §8.1); SSE `browser.tab_updated` when it changes. */
export const userTabStateSchema = z.object({
  tabId: z.string(),
  taskId: z.string(),
  /** The page's address; empty until the first page loads. */
  url: z.string(),
  viewport: viewportPresetSchema,
  /** Of the current page: console errors (uncaught exceptions included) and requests that failed or answered ≥ 400. */
  consoleErrors: z.number().int(),
  failedRequests: z.number().int(),
});
export type UserTabState = z.infer<typeof userTabStateSchema>;

/**
 * `GET /tasks/:id/preview/sessions` (29 §8.1): what the preview tab can show besides the user's own preview, the AI
 * sessions that used the browser (with their frames) and the steps whose page check left screenshots.
 */
export const previewSessionsSchema = z.object({
  attempts: z.array(
    z.object({
      attemptId: z.string(),
      nodeId: z.string().nullable(),
      kind: attemptKindSchema,
      status: attemptStatusSchema,
      frames: z.number().int(),
    }),
  ),
  checks: z.array(z.object({ nodeId: z.string(), passed: z.boolean() })),
});
export type PreviewSessions = z.infer<typeof previewSessionsSchema>;

/** `GET /browser/tabs/:tabId/logs` (29 §8.1): what the bottom bar's counts are made of, for the current page. */
export const userTabLogsSchema = z.object({
  /** Console errors and uncaught exceptions, in order. */
  errors: z.array(z.object({ message: z.string(), source: z.string().nullable() })),
  /** Requests that failed or answered ≥ 400. */
  requests: z.array(
    z.object({ method: z.string(), url: z.string(), status: z.number().nullable(), error: z.string().nullable() }),
  ),
});
export type UserTabLogs = z.infer<typeof userTabLogsSchema>;
