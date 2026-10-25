import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';

// Main's browser tabs (29 §5.1, B-04) in real Electron: e2e/fixtures/browser-host runs `browser.ts` with a local web
// server and stands in for the backend, so the tests send the same `browser.request` operations it will.

let app: ElectronApplication;
test.beforeEach(async () => {
  app = await electron.launch({ args: ['e2e/fixtures/browser-host/main.cjs'] });
  // The host creates its window after the harness.
  await app.firstWindow();
});
test.afterEach(() => app.close());

type Harness = {
  origin: string;
  tabs: { handle(op: unknown): Promise<unknown>; place(tabId: string, rect: unknown): void };
  events: Array<{ type: string; tabId?: string; method?: string; reason?: string; url?: string }>;
  requests: string[];
  answers: { login: { username: string; password: string } | null; certificate: string | null };
  next(matches: (event: { type: string; tabId?: string; method?: string }) => boolean): Promise<unknown>;
};
declare global {
  var harness: Harness | undefined;
}

/** Opens a tab and loads `path` of the test server, waiting for the page's load event as the backend would. */
async function openTab(options: {
  tabId: string;
  partition: string;
  userFacing: boolean;
  sites?: Array<{ pattern: string; access: 'read' | 'interact' }>;
  preview?: boolean;
  path?: string;
}): Promise<void> {
  await app.evaluate(async (_electron, o) => {
    const h = globalThis.harness as Harness;
    await h.tabs.handle({
      kind: 'open',
      tabId: o.tabId,
      partition: o.partition,
      userFacing: o.userFacing,
      viewport: o.userFacing ? null : { width: 1280, height: 800, mobile: false },
      // As main gets it from the port, parsed with the rules' defaults.
      policy: {
        previewOrigins: o.preview ? [h.origin] : [],
        sites: (o.sites ?? []).map((rule) => ({ queryPaths: [], ...rule })),
      },
      integratedAuthServers: [],
    });
    if (o.userFacing) h.tabs.place(o.tabId, { x: 0, y: 0, width: 1000, height: 700 });
    const cdp = (method: string, params?: object) => h.tabs.handle({ kind: 'cdp', tabId: o.tabId, method, params });
    await cdp('Page.enable');
    const loaded = h.next((e) => e.tabId === o.tabId && e.method === 'Page.loadEventFired');
    await cdp('Page.navigate', { url: `${h.origin}${o.path ?? '/'}` });
    await loaded;
  }, options);
}

/** Runs `expression` in the tab's page and returns its value. */
function evaluate(tabId: string, expression: string): Promise<unknown> {
  return app.evaluate(
    async (_electron, { tabId, expression }) => {
      const h = globalThis.harness as Harness;
      const { result } = (await h.tabs.handle({
        kind: 'cdp',
        tabId,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      })) as { result: { value: unknown } };
      return result.value;
    },
    { tabId, expression },
  );
}

const WRITES = `(async () => {
  const out = {};
  out.post = await fetch('/api/write', { method: 'POST', body: 'x' }).then((r) => r.status, () => 'blocked');
  out.get = await fetch('/api/read').then((r) => r.status, () => 'blocked');
  out.ws = await new Promise((done) => {
    const socket = new WebSocket('ws://' + location.host + '/socket');
    socket.onopen = () => done('open');
    socket.onerror = () => done('blocked');
  });
  return out;
})()`;

test('离屏标签页：CDP 点击与输入生效，视口为给定的尺寸', async () => {
  await openTab({ tabId: 'ai', partition: 'aw-attempt-1', userFacing: false, preview: true });
  expect(await evaluate('ai', '({ w: innerWidth, h: innerHeight })')).toEqual({ w: 1280, h: 800 });

  const clicked = await app.evaluate(async () => {
    const h = globalThis.harness as Harness;
    const cdp = (method: string, params?: object) => h.tabs.handle({ kind: 'cdp', tabId: 'ai', method, params });
    const centre = async (selector: string) => {
      const { root } = (await cdp('DOM.getDocument')) as { root: { nodeId: number } };
      const { nodeId } = (await cdp('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number };
      const { model } = (await cdp('DOM.getBoxModel', { nodeId })) as { model: { content: number[] } };
      const [x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = model.content;
      return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
    };
    const click = async (selector: string) => {
      const { x, y } = await centre(selector);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    };
    await click('button');
    await click('#b');
    await cdp('Input.insertText', { text: 'hello' });
    return true;
  });
  expect(clicked).toBe(true);
  expect(await evaluate('ai', '({ clicked: window.clicked, b: b.value, active: document.activeElement.id })')).toEqual({
    clicked: 1,
    b: 'hello',
    active: 'b',
  });
});

test('只读网站：AI 标签页的写请求与 WebSocket 被拦下并报告，同一分区里用户标签页照常', async () => {
  const sites = [{ pattern: '127.0.0.1', access: 'read' as const }];
  await openTab({ tabId: 'ai', partition: 'persist:aw-sites', userFacing: false, sites });
  await openTab({ tabId: 'user', partition: 'persist:aw-sites', userFacing: true, sites });

  expect(await evaluate('ai', WRITES)).toEqual({ post: 'blocked', get: 200, ws: 'blocked' });
  expect(await evaluate('user', WRITES)).toEqual({ post: 200, get: 200, ws: 'open' });

  const { blocked, requests } = await app.evaluate(() => {
    const h = globalThis.harness as Harness;
    return {
      blocked: h.events.filter((e) => e.type === 'browser.blocked').map((e) => [e.tabId, e.method, e.reason]),
      requests: h.requests.filter((r) => r !== 'GET /'),
    };
  });
  expect(blocked).toEqual([
    ['ai', 'POST', 'read_only'],
    ['ai', 'GET', 'read_only'],
  ]);
  // Only the user's tab wrote, and only its WebSocket was upgraded.
  expect(requests.sort()).toEqual(['GET /api/read', 'GET /api/read', 'POST /api/write', 'UPGRADE /socket']);
});

test('不允许的地址：AI 标签页里被拦下，用户标签页交给系统浏览器', async () => {
  await openTab({ tabId: 'ai', partition: 'aw-attempt-2', userFacing: false, preview: true });
  await openTab({ tabId: 'user', partition: 'aw-preview-1', userFacing: true, preview: true });
  // localhost is another origin than the preview's 127.0.0.1, and no website rule allows it.
  const elsewhere = await app.evaluate(() => (globalThis.harness as Harness).origin.replace('127.0.0.1', 'localhost'));

  expect(await evaluate('ai', `fetch('${elsewhere}/api/read').then(() => 'loaded', () => 'blocked')`)).toBe('blocked');
  const external = await app.evaluate(async (_electron, target) => {
    const h = globalThis.harness as Harness;
    const handedOver = h.next((e) => e.type === 'external');
    await h.tabs.handle({
      kind: 'cdp',
      tabId: 'user',
      method: 'Runtime.evaluate',
      params: { expression: `location.href = '${target}'` },
    });
    return handedOver;
  }, `${elsewhere}/`);
  expect(external).toEqual({ type: 'external', url: `${elsewhere}/` });
  expect(await evaluate('user', 'location.origin')).not.toBe(elsewhere);
  const blocked = await app.evaluate(() =>
    (globalThis.harness as Harness).events.filter((e) => e.type === 'browser.blocked').map((e) => [e.tabId, e.reason]),
  );
  expect(blocked).toEqual([['ai', 'not_allowed']]);
});

test('共享 Worker 的请求无法归属标签页时拒绝写入，并报告未归属的拦截', async () => {
  await openTab({
    tabId: 'ai',
    partition: 'persist:aw-sites',
    userFacing: false,
    sites: [{ pattern: '127.0.0.1', access: 'read' }],
  });
  expect(
    await evaluate(
      'ai',
      `new Promise((resolve) => {
    const worker = new SharedWorker('/shared-worker.js');
    worker.port.onmessage = ({ data }) => { worker.port.close(); resolve(data); };
    worker.onerror = () => resolve('blocked');
  })`,
    ),
  ).toBe('blocked');
  const result = await app.evaluate(() => {
    const h = globalThis.harness as Harness;
    return { requests: h.requests, blocked: h.events.filter((e) => e.type === 'browser.unownedBlocked') };
  });
  expect(result.requests).not.toContain('POST /api/worker-write');
  expect(result.blocked).toEqual(
    expect.arrayContaining([expect.objectContaining({ url: expect.stringMatching(/\/api\/worker-write$/) })]),
  );
});

test('HTTP 认证：AI 标签页不弹出、得到 401；用户在自己的标签页里登录后，同一分区的 AI 标签页沿用登录', async () => {
  const sites = [{ pattern: '127.0.0.1', access: 'read' as const }];
  const partition = 'aw-sites-auth';
  await openTab({ tabId: 'ai', partition, userFacing: false, sites });
  expect(await evaluate('ai', `fetch('/wiki').then((r) => r.status)`)).toBe(401);

  await app.evaluate(() => {
    (globalThis.harness as Harness).answers.login = { username: 'reader', password: 'secret' };
  });
  await openTab({ tabId: 'user', partition, userFacing: true, sites, path: '/wiki' });
  expect(await evaluate('user', 'document.title')).toBe('wiki');
  expect(await evaluate('ai', `fetch('/wiki').then((r) => r.status)`)).toBe(200);

  const prompts = await app.evaluate(() =>
    (globalThis.harness as Harness).events.filter((e) => e.type.startsWith('prompt.')),
  );
  // Only the user's tab asked, once; the AI's tab neither asked nor got anything to answer.
  expect(prompts).toEqual([
    { type: 'prompt.login', host: '127.0.0.1', realm: 'wiki', scheme: 'basic', isProxy: false },
  ]);
});

test('HTTP 认证：用户取消时页面得到 401，AI 标签页仍然没有登录', async () => {
  const sites = [{ pattern: '127.0.0.1', access: 'read' as const }];
  const partition = 'aw-sites-cancel';
  await openTab({ tabId: 'user', partition, userFacing: true, sites, path: '/wiki' });
  expect(await evaluate('user', 'document.title')).toBe('401');
  await openTab({ tabId: 'ai', partition, userFacing: false, sites });
  expect(await evaluate('ai', `fetch('/wiki').then((r) => r.status)`)).toBe(401);
});
