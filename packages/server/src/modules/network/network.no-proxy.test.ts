import { describe, expect, it } from 'vitest';
import { chromiumBypassRules, noProxyMatcher } from './network.no-proxy.ts';

describe('NO_PROXY 的写法（D174）', () => {
  const direct = noProxyMatcher([
    '10.0.0.0/8',
    'fd00::/8',
    '192.168.1.7',
    '.corp.example',
    '*.lab.example, wiki.example:8080',
    'bad.0.0.0/99',
  ]);
  it.each([
    ['10.20.30.40', 443, true],
    ['11.0.0.1', 443, false],
    ['[fd12::1]', 443, true],
    ['::ffff:10.1.2.3', 443, true],
    ['192.168.1.7', 80, true],
    ['192.168.1.70', 80, false],
    ['gitlab.corp.example', 443, true],
    ['corp.example', 443, true],
    ['notcorp.example', 443, false],
    ['git.lab.example', 443, true],
    ['wiki.example', 8080, true],
    ['wiki.example', 443, false],
  ])('%s:%i 直连：%s', (host, port, expected) => {
    expect(direct(host, port)).toBe(expected);
  });

  it('名称规则不匹配 IP、IP 规则不匹配名称：都按 URL 里写的比较，不解析', () => {
    const rules = noProxyMatcher(['0.0.1', '10.0.0.0/8']);
    expect(rules('127.0.0.1', 80)).toBe(false);
    expect(rules('10.example', 80)).toBe(false);
  });

  it('只写 * 时一律直连；空列表一律不直连', () => {
    expect(noProxyMatcher(['*'])('github.com', 443)).toBe(true);
    expect(noProxyMatcher([])('github.com', 443)).toBe(false);
  });
});

describe('换算成 Chromium 的 bypass 规则（D176）', () => {
  it('名称加上子域名，网段与地址原样，IPv6 地址加方括号', () => {
    expect(chromiumBypassRules(['.corp.example', 'wiki.example:8080', '10.0.0.0/8', 'fd00::1', '*'])).toBe(
      'corp.example;*.corp.example;wiki.example:8080;*.wiki.example:8080;10.0.0.0/8;[fd00::1];*',
    );
  });
});
