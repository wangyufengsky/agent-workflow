import { z } from 'zod';
import { browserWriteRuleSchema } from '../../browser/policy.ts';
import { viewportPresetSchema } from '../../enums/browser.ts';
import { attemptKindSchema, attemptStatusSchema } from '../../enums/task.ts';
import {
  browserActionOutputSchema,
  browserClickInputSchema,
  browserLogsOutputSchema,
  browserPageSchema,
  browserPressInputSchema,
  browserSelectInputSchema,
  browserTypeInputSchema,
} from '../mcp/browser.ts';
import { frontendElementSchema, frontendPageLayoutSchema } from './frontend.ts';

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
/** `browser_read` (15, 29 §8.1): the user's preview tab the UI bound to the conversation, as the assistant reads it. */
export const readPreviewSchema = browserPageSchema.extend({
  settled: z.boolean(),
  taskId: z.string(),
  viewport: viewportPresetSchema,
  layout: frontendPageLayoutSchema.optional(),
  selectedElement: frontendElementSchema.optional(),
  logs: browserLogsOutputSchema,
});

export const assistantBrowserActionSchema = z.object({
  action: z.discriminatedUnion('kind', [
    browserClickInputSchema.extend({ kind: z.literal('click') }),
    browserTypeInputSchema.omit({ submit: true }).extend({ kind: z.literal('type'), text: z.string().max(4000) }),
    browserSelectInputSchema.extend({ kind: z.literal('select') }),
    browserPressInputSchema.extend({ kind: z.literal('press') }),
  ]),
  write: browserWriteRuleSchema.optional().describe('Exact same-origin HTTP write needed for this action, if known'),
});
export type AssistantBrowserAction = z.infer<typeof assistantBrowserActionSchema>;

export const assistantBrowserConfirmationSchema = z.object({
  requestId: z.string(),
  page: z.string(),
  target: z.string(),
  fields: z.array(z.string()),
  write: browserWriteRuleSchema.optional(),
});
export const AssistantBrowserMode = { Off: 'off', Assistant: 'assistant', Manual: 'manual' } as const;
export type AssistantBrowserMode = (typeof AssistantBrowserMode)[keyof typeof AssistantBrowserMode];

export const AssistantBrowserActivityKind = {
  Click: 'click',
  Type: 'type',
  Select: 'select',
  Press: 'press',
  Take: 'take',
  Return: 'return',
} as const;
export type AssistantBrowserActivityKind =
  (typeof AssistantBrowserActivityKind)[keyof typeof AssistantBrowserActivityKind];

export const AssistantBrowserActivityOutcome = {
  Done: 'done',
  Confirmation: 'confirmation',
  Blocked: 'blocked',
  Failed: 'failed',
} as const;
export type AssistantBrowserActivityOutcome =
  (typeof AssistantBrowserActivityOutcome)[keyof typeof AssistantBrowserActivityOutcome];

export const assistantBrowserActivitySchema = z.object({
  id: z.number().int(),
  kind: z.enum(AssistantBrowserActivityKind),
  outcome: z.enum(AssistantBrowserActivityOutcome),
  page: z.string(),
  target: z.string().nullable(),
  blockedRequests: z.array(z.string()),
  at: z.number(),
});
export type AssistantBrowserActivity = z.infer<typeof assistantBrowserActivitySchema>;

export const assistantBrowserControlSchema = z.object({
  mode: z.enum(AssistantBrowserMode),
  activity: z.array(assistantBrowserActivitySchema),
});

export const assistantBrowserResultSchema = browserActionOutputSchema.omit({ frame: true });

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
  /** A path of the preview: `//host` would leave it. */
  path: z.string().regex(/^\/(?!\/)/),
});
export const setUserViewportRequestSchema = z.object({ tabId: z.string(), preset: viewportPresetSchema });

/** The local route, including client-side routing and filter state. */
export function previewPathFromUrl({
  pathname,
  search,
  hash,
}: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${pathname}${search}${hash}`;
}

/** The user's preview tab as the bottom bar shows it (29 §8.1); SSE `browser.tab_updated` when it changes. */
export const userTabStateSchema = z.object({
  tabId: z.string(),
  taskId: z.string(),
  /** The page's address; empty until the first page loads. */
  url: z.string(),
  viewport: viewportPresetSchema,
  picking: z.boolean().optional(),
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
      screenshots: z.array(z.string()).default([]),
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
