import { z } from 'zod';
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
