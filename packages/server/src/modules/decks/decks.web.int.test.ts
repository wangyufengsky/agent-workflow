import { createServer, type Server } from 'node:http';
import { createDeckOp, ErrorCode, listDecksOp, SlideLayout, updateSettingsOp } from '@aw/shared';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createChromiumHost } from '../../../test/helpers/browser.ts';

let server: Server;
let origin: string;
let host: ReturnType<typeof createChromiumHost>;
let t: TestApp;
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const pages: Record<string, string> = {
      '/article': '<title>发布说明</title><h1>发布步骤</h1><p>先检查，再发布。</p><img src="/gone.png" alt="">',
      '/login': '<title>登录</title><input type="password" aria-label="密码">',
    };
    const body = pages[req.url ?? ''];
    res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));
beforeEach(async () => {
  requests.length = 0;
  host = createChromiumHost();
  t = await createTestApp({ browserHost: host });
  // 任务可以操作这个网站，PPT 资料仍只按只读打开。
  await t.call(updateSettingsOp, { 'browser.sites': [{ pattern: '127.0.0.1', access: 'interact' }] });
});
afterEach(async () => {
  await t.close();
  await host.close();
});

const OUTLINE = {
  title: '发布说明',
  understanding: { audience: '团队同事', duration: '约 5 分钟', assumptions: [] },
  slides: [{ layout: SlideLayout.Cover, title: '发布说明', points: ['发布步骤'] }],
};

it('网页资料按网站规则只读打开一次，正文快照写入首条消息', async () => {
  t.fake.enqueue(script().callTool('submit_outline', OUTLINE), { agent: 'aw-slides' });
  const res = await t.call(createDeckOp, {
    brief: '把发布说明做成 PPT',
    materials: [{ kind: 'web', url: `${origin}/article` }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await t.fake.settled();
  expect(res.body).toMatchObject({
    project: null,
    materials: [{ kind: 'web', refId: `${origin}/article`, title: '发布说明' }],
  });
  const writer = t.fake.sessions.find((s) => s.agent === 'aw-slides');
  const first = t.fake.prompts.find((p) => p.sessionId === writer?.id)?.text ?? '';
  expect(first).toContain('<material index="1" kind="web" title="发布说明">');
  expect(first).toContain(`URL: ${origin}/article`);
  expect(first).toContain('先检查，再发布。');
  expect(requests.filter((r) => r === 'GET /article')).toHaveLength(1);
  expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
});

it('不允许的地址、要登录与出错的网页报对应错误，不建 PPT', async () => {
  const create = (url: string) =>
    t.call(createDeckOp, { brief: '做成 PPT', materials: [{ kind: 'web', url }] }).then((r) => r.body);
  expect(await create(origin.replace('127.0.0.1', 'localhost'))).toMatchObject({
    error: { code: ErrorCode.BrowserSiteNotAllowed },
  });
  expect(await create(`${origin}/login`)).toMatchObject({ error: { code: ErrorCode.BrowserLoginRequired } });
  // 页面本身 404 时不能把错误页当资料；资料页里的图片 404 不影响（上一个用例）。
  expect(await create(`${origin}/removed`)).toMatchObject({
    error: { code: ErrorCode.BrowserReadFailed, details: { status: 404 } },
  });
  expect((await t.call(listDecksOp, {})).body.items).toEqual([]);
  expect(t.fake.sessions).toEqual([]);
});
