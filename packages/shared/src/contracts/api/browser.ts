import { z } from 'zod';
import { viewportPresetSchema } from '../../enums/browser.ts';
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
export const userPreviewTabSchema = userTabSchema.extend({ viewport: viewportPresetSchema });
export type UserPreviewTab = z.infer<typeof userPreviewTabSchema>;

export const openPreviewTabRequestSchema = z.object({ taskId: z.string() });
export const navigatePreviewTabRequestSchema = userTabSchema.extend({ path: z.string().regex(/^\/(?!\/)/) });
export const previewTabViewportRequestSchema = userTabSchema.extend({ preset: viewportPresetSchema });
export const readPreviewSchema = browserPageSchema.extend({
  settled: z.boolean(),
  taskId: z.string(),
  viewport: viewportPresetSchema,
  logs: browserLogsOutputSchema,
});

/** Hosts with cookies in the websites' login partition. */
export const siteLoginsSchema = z.object({ hosts: z.array(z.string()) });
export type SiteLogins = z.infer<typeof siteLoginsSchema>;
