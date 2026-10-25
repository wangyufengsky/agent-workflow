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
  /**
   * Read-only websites: paths whose POST only queries (old intranet systems search with POST, 29 §5.4), where the
   * AI's POSTs go through. `*` matches any characters; the whole path must match, case and all, the query string
   * aside. Rules saved before there were any have none.
   */
  queryPaths: z
    .array(
      z
        .string()
        .regex(/^\/[^\s?#]*$/)
        .describe('Path starting with /; * matches any characters'),
    )
    .default([]),
});
export type SiteRule = z.infer<typeof siteRuleSchema>;

/**
 * A server the websites' partition logs in to with the user's system login (NTLM / Negotiate, 29 §5.4): a host
 * pattern as Chromium's `auth-server-allowlist` takes it (`*.corp.example.com`, `wiki.corp`). It must name servers:
 * `*` alone would hand the user's domain login to any website.
 */
export const integratedAuthServerSchema = z
  .string()
  .regex(/^[a-z0-9*.-]+$/i)
  .refine((pattern) => /[a-z0-9]/i.test(pattern), 'Name the servers, not every host')
  .describe('Host name pattern of servers given the system login; * matches any characters');

/** What a tab may open: its task's preview origins and the website rules in order. */
export const browserPolicySchema = z.object({
  previewOrigins: z.array(z.string()),
  sites: z.array(siteRuleSchema),
});
export type BrowserPolicy = z.infer<typeof browserPolicySchema>;

export type UrlAccess =
  | { tab: typeof BrowserTabKind.Preview }
  | { tab: typeof BrowserTabKind.Site; access: SiteAccess };

/** A whole host name (case-insensitive) or path (case-sensitive) matching a pattern where `*` is any characters. */
function patternRegExp(pattern: string, flags: '' | 'i'): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\/-]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, flags);
}

/**
 * Scheme, host and port of an absolute address. Addresses come from Chromium (main) or are resolved by the backend
 * first, so they are already normalized; shared has no runtime globals such as `URL` (03 §4).
 */
const ADDRESS = /^(https?|wss?):\/\/(?:[^/?#@]*@)?(\[[^\]/]*\]|[^/?#:]+)(?::(\d+))?(\/[^?#]*)?(?:[?#]|$)/i;
const DEFAULT_PORT: Record<string, string> = { http: '80', https: '443' };

/** WebSocket addresses belong to the HTTP origin they upgrade from. */
function httpAddress(raw: string): { origin: string; hostname: string; path: string } | null {
  const match = ADDRESS.exec(raw);
  if (match === null) return null;
  const [, scheme = '', host = '', port, path = '/'] = match;
  const http = scheme.toLowerCase().replace(/^ws/, 'http');
  const hostname = host.toLowerCase();
  const shownPort = port === undefined || port === DEFAULT_PORT[http] ? '' : `:${port}`;
  return { origin: `${http}://${hostname}${shownPort}`, hostname, path };
}

/** The address, and the preview (null) or the first matching website rule; undefined when neither allows it. */
function ruleOf(raw: string, policy: BrowserPolicy) {
  const address = httpAddress(raw);
  if (address === null) return undefined;
  if (policy.previewOrigins.includes(address.origin)) return { address, rule: null };
  const rule = policy.sites.find((r) => patternRegExp(r.pattern, 'i').test(address.hostname));
  return rule === undefined ? undefined : { address, rule };
}

/** The preview when the origin is one of its origins, else the first matching website rule; null when neither. */
export function urlAccess(raw: string, policy: BrowserPolicy): UrlAccess | null {
  const found = ruleOf(raw, policy);
  if (found === undefined) return null;
  return found.rule === null
    ? { tab: BrowserTabKind.Preview }
    : { tab: BrowserTabKind.Site, access: found.rule.access };
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
  const found = ruleOf(request.url, policy);
  if (found === undefined) return BrowserBlockReason.NotAllowed;
  const { address, rule } = found;
  if (!readOnlyEnforced || rule === null || rule.access !== SiteAccess.Read) return null;
  if (request.isWebSocket) return BrowserBlockReason.ReadOnly;
  const method = request.method.toUpperCase();
  if (READ_METHODS.has(method)) return null;
  // A POST to a path the rule names as a query; every other write to a read-only website is cancelled.
  const query = method === 'POST' && rule.queryPaths.some((p) => patternRegExp(p, '').test(address.path));
  return query ? null : BrowserBlockReason.ReadOnly;
}
