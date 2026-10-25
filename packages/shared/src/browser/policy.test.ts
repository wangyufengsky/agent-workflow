import { describe, expect, it } from 'vitest';
import { type BrowserPolicy, blockReason, urlAccess } from './policy.ts';

const policy: BrowserPolicy = {
  previewOrigins: ['http://127.0.0.1:5173'],
  sites: [
    { pattern: 'tickets.corp', access: 'interact', queryPaths: [] },
    { pattern: '*.corp', access: 'read', queryPaths: [] },
    { pattern: '10.12.*.*', access: 'read', queryPaths: [] },
  ],
};

describe('urlAccess', () => {
  it('预览来源走预览标签页，端口不同就不是预览', () => {
    expect(urlAccess('http://127.0.0.1:5173/orders?x=1', policy)).toEqual({ tab: 'preview' });
    expect(urlAccess('http://127.0.0.1:5174/', policy)).toBeNull();
  });

  it('按顺序取第一条匹配的规则', () => {
    expect(urlAccess('https://tickets.corp/T-1', policy)).toEqual({ tab: 'site', access: 'interact' });
    expect(urlAccess('https://wiki.corp/page', policy)).toEqual({ tab: 'site', access: 'read' });
  });

  it('通配符匹配整个主机名，不区分大小写，*. 不匹配上一级域名本身', () => {
    expect(urlAccess('https://A.B.CORP/x', policy)).toEqual({ tab: 'site', access: 'read' });
    expect(urlAccess('https://corp/', policy)).toBeNull();
    expect(urlAccess('https://wiki.corp.evil.com/', policy)).toBeNull();
    expect(urlAccess('http://10.12.3.4:8080/', policy)).toEqual({ tab: 'site', access: 'read' });
  });

  it('WebSocket 地址按它升级前的 HTTP 来源判断', () => {
    expect(urlAccess('ws://127.0.0.1:5173/hmr', policy)).toEqual({ tab: 'preview' });
    expect(urlAccess('wss://wiki.corp/live', policy)).toEqual({ tab: 'site', access: 'read' });
  });

  it('协议大小写、默认端口与地址中的用户信息不影响判断', () => {
    expect(urlAccess('HTTP://127.0.0.1:5173/', policy)).toEqual({ tab: 'preview' });
    expect(urlAccess('https://wiki.corp:443/x', policy)).toEqual({ tab: 'site', access: 'read' });
    expect(urlAccess('https://someone@wiki.corp/x', policy)).toEqual({ tab: 'site', access: 'read' });
  });

  it('非 http(s) 地址与无法解析的地址不允许', () => {
    expect(urlAccess('file:///etc/passwd', policy)).toBeNull();
    expect(urlAccess('not a url', policy)).toBeNull();
  });

  it('规则 * 放开所有网站', () => {
    expect(
      urlAccess('https://example.com/', {
        previewOrigins: [],
        sites: [{ pattern: '*', access: 'read', queryPaths: [] }],
      }),
    ).toEqual({ tab: 'site', access: 'read' });
  });
});

describe('blockReason', () => {
  const get = (url: string) => ({ url, method: 'GET', isWebSocket: false });

  it('不允许的地址拦下', () => {
    expect(blockReason(get('https://example.com/'), policy, true)).toBe('not_allowed');
    expect(blockReason(get('https://example.com/'), policy, false)).toBe('not_allowed');
  });

  it('AI 标签页对只读网站的写请求与 WebSocket 拦下，读请求放行', () => {
    expect(blockReason({ url: 'https://wiki.corp/api', method: 'post', isWebSocket: false }, policy, true)).toBe(
      'read_only',
    );
    expect(blockReason({ url: 'wss://wiki.corp/live', method: 'GET', isWebSocket: true }, policy, true)).toBe(
      'read_only',
    );
    expect(blockReason(get('https://wiki.corp/api'), policy, true)).toBeNull();
    expect(blockReason({ url: 'https://wiki.corp/', method: 'OPTIONS', isWebSocket: false }, policy, true)).toBeNull();
  });

  it('用户自己的标签页、可操作的网站与预览不做只读拦截', () => {
    const post = (url: string) => ({ url, method: 'POST', isWebSocket: false });
    expect(blockReason(post('https://wiki.corp/api'), policy, false)).toBeNull();
    expect(blockReason(post('https://tickets.corp/api'), policy, true)).toBeNull();
    expect(blockReason(post('http://127.0.0.1:5173/api'), policy, true)).toBeNull();
  });

  it('只读网站规则写明的查询路径：AI 的 POST 放行；别的路径、别的写方法与 WebSocket 仍拦下', () => {
    const queries: BrowserPolicy = {
      previewOrigins: [],
      sites: [{ pattern: 'bugs.corp', access: 'read', queryPaths: ['/api/search', '/rest/*/query'] }],
    };
    const request = (method: string, url: string, isWebSocket = false) => ({ method, url, isWebSocket });
    expect(blockReason(request('POST', 'https://bugs.corp/api/search?page=2'), queries, true)).toBeNull();
    expect(blockReason(request('post', 'https://bugs.corp/rest/issue/query'), queries, true)).toBeNull();
    // The whole path matches, case and all: neither a longer path nor another case is a query.
    expect(blockReason(request('POST', 'https://bugs.corp/api/search/save'), queries, true)).toBe('read_only');
    expect(blockReason(request('POST', 'https://bugs.corp/API/search'), queries, true)).toBe('read_only');
    expect(blockReason(request('POST', 'https://bugs.corp/api/comments'), queries, true)).toBe('read_only');
    expect(blockReason(request('PUT', 'https://bugs.corp/api/search'), queries, true)).toBe('read_only');
    expect(blockReason(request('GET', 'wss://bugs.corp/api/search', true), queries, true)).toBe('read_only');
  });
});
