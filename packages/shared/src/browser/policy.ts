import { z } from 'zod';
import { BrowserBlockReason, BrowserTabKind, SiteAccess, siteAccessSchema } from '../enums/browser.ts';

/**
 * A website rule (29 §5.4): a host pattern where `*` stands for any run of characters (`*`, `*.corp.example.com`,
 * `wiki.corp`, `10.12.*.*`), matched case-insensitively against the whole host name, ports ignored.
 */
export const siteRuleSchema = z.object({
  pattern: z
    .string()
    .regex(/^[a-z0-9*.-]+$/i)
    .describe('Host name pattern; * matches any characters'),
  access: siteAccessSchema,
});
export type SiteRule = z.infer<typeof siteRuleSchema>;

/** What a tab may open: its task's preview origins and the website rules in order. */
export const browserPolicySchema = z.object({
  previewOrigins: z.array(z.string()),
  sites: z.array(siteRuleSchema),
});
export type BrowserPolicy = z.infer<typeof browserPolicySchema>;

export type UrlAccess =
  | { tab: typeof BrowserTabKind.Preview }
  | { tab: typeof BrowserTabKind.Site; access: SiteAccess };

function patternRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.-]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Scheme, host and port of an absolute address. Addresses come from Chromium (main) or are resolved by the backend
 * first, so they are already normalized; shared has no runtime globals such as `URL` (03 §4).
 */
const ADDRESS = /^(https?|wss?):\/\/(?:[^/?#@]*@)?(\[[^\]/]*\]|[^/?#:]+)(?::(\d+))?(?:[/?#]|$)/i;
const DEFAULT_PORT: Record<string, string> = { http: '80', https: '443' };

/** WebSocket addresses belong to the HTTP origin they upgrade from. */
function httpAddress(raw: string): { origin: string; hostname: string } | null {
  const match = ADDRESS.exec(raw);
  if (match === null) return null;
  const [, scheme = '', host = '', port] = match;
  const http = scheme.toLowerCase().replace(/^ws/, 'http');
  const hostname = host.toLowerCase();
  const shownPort = port === undefined || port === DEFAULT_PORT[http] ? '' : `:${port}`;
  return { origin: `${http}://${hostname}${shownPort}`, hostname };
}

/** The preview when the origin is one of its origins, else the first matching website rule; null when neither. */
export function urlAccess(raw: string, policy: BrowserPolicy): UrlAccess | null {
  const address = httpAddress(raw);
  if (address === null) return null;
  if (policy.previewOrigins.includes(address.origin)) return { tab: BrowserTabKind.Preview };
  const rule = policy.sites.find((r) => patternRegExp(r.pattern).test(address.hostname));
  return rule === undefined ? null : { tab: BrowserTabKind.Site, access: rule.access };
}

/** Only these leave a read-only website untouched (29 §5.4); a WebSocket can write once open, so it never does. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Why Electron main cancels a request from a tab, or null to let it through. `readOnlyEnforced` is set for the AI's
 * tabs: the user's own tabs write as the user does.
 */
export function blockReason(
  request: { url: string; method: string; isWebSocket: boolean },
  policy: BrowserPolicy,
  readOnlyEnforced: boolean,
): BrowserBlockReason | null {
  const access = urlAccess(request.url, policy);
  if (access === null) return BrowserBlockReason.NotAllowed;
  const isWrite = request.isWebSocket || !READ_METHODS.has(request.method.toUpperCase());
  if (readOnlyEnforced && access.tab === BrowserTabKind.Site && access.access === SiteAccess.Read && isWrite) {
    return BrowserBlockReason.ReadOnly;
  }
  return null;
}
