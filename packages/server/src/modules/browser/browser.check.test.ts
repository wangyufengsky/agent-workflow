import { describe, expect, it } from 'vitest';
import { type PageFacts, pageCheckVerdict } from './browser.check.ts';
import type { RequestEntry } from './browser.tab.ts';

const request = (resourceType: string, status: number | null, extra: Partial<RequestEntry> = {}): RequestEntry => ({
  method: 'GET',
  url: `http://127.0.0.1:5173/${resourceType.toLowerCase()}`,
  status,
  resourceType,
  error: null,
  blocked: null,
  ...extra,
});
const page = (facts: Partial<PageFacts>): PageFacts => ({
  navigationError: null,
  console: [],
  exceptions: [],
  requests: [request('Document', 200)],
  overflow: false,
  a11y: [],
  settled: true,
  ...facts,
});
const kinds = (facts: Partial<PageFacts>) => {
  const v = pageCheckVerdict(page(facts));
  return { errors: v.errors.map((e) => e.kind), warnings: v.warnings.map((w) => w.kind) };
};

describe('pageCheckVerdict（29 §7.3）', () => {
  it('主文档加载失败或状态 ≥ 400 不通过', () => {
    expect(kinds({ navigationError: 'net::ERR_CONNECTION_REFUSED', requests: [] }).errors).toEqual(['navigation']);
    expect(pageCheckVerdict(page({ requests: [request('Document', 500)] }))).toMatchObject({
      httpStatus: 500,
      errors: [{ kind: 'navigation', message: 'The page answered HTTP 500' }],
    });
  });

  it('未捕获异常与 console.error 不通过，console 警告不算', () => {
    expect(
      kinds({
        exceptions: [{ message: 'TypeError: x is undefined', source: '/app.js' }],
        console: [
          { level: 'error', text: 'boom', source: null },
          { level: 'warning', text: 'deprecated', source: null },
        ],
      }).errors,
    ).toEqual(['exception', 'console']);
  });

  it('脚本、样式、图片、字体失败不通过；接口 5xx 与网络错误不通过，4xx 只提醒', () => {
    expect(
      kinds({
        requests: [
          request('Document', 200),
          request('Script', 404),
          request('Image', null, { error: 'net::ERR_FAILED' }),
          request('Fetch', 502),
          request('XHR', null, { error: 'net::ERR_CONNECTION_RESET' }),
          request('Fetch', 401),
          request('Fetch', 200),
        ],
      }),
    ).toEqual({ errors: ['request', 'request', 'request', 'request'], warnings: ['request'] });
  });

  it('被规则拦下的请求、可访问性严重问题、横向溢出、没有稳定只提醒', () => {
    expect(
      kinds({
        requests: [
          request('Document', 200),
          request('Script', null, { error: 'net::ERR_BLOCKED_BY_CLIENT', blocked: 'not_allowed' }),
        ],
        a11y: [{ id: 'color-contrast', help: 'Elements must meet minimum color contrast', nodes: 3 }],
        overflow: true,
        settled: false,
      }),
    ).toEqual({ errors: [], warnings: ['blocked', 'a11y', 'overflow', 'unsettled'] });
  });
});
