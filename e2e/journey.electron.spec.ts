import { cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';
import { git } from './helpers.ts';

// J10 (07 §5): the built app with the real opencode and the free test model (D50). AW_E2E_EXECUTABLE points at a
// packaged binary (for example the copy of a mounted dmg, M6-04); otherwise the built, unpackaged app is launched.
// Every run uses a fresh user data directory, so the app starts as on first launch.
const executablePath = process.env.AW_E2E_EXECUTABLE;
const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-userdata-'));
const TASK_TIMEOUT_MS = 20 * 60_000;
/** Screenshots of the first launch and the result for the acceptance report (not committed). */
const SHOTS = 'screenshots/electron';

function launch(): Promise<ElectronApplication> {
  const args = [`--user-data-dir=${userDataDir}`];
  return electron.launch(executablePath ? { executablePath, args } : { args: ['apps/desktop', ...args] });
}

/** The backend this window talks to: its random port and per-launch token. */
async function backend(page: Page) {
  const token = await page.evaluate(() => window.aw?.apiToken ?? '');
  const base = `${new URL(page.url()).origin}/api/v1`;
  return { base, headers: { Authorization: `Bearer ${token}` } };
}

/** A copy of the live fixture ts-stats (`median` sorts as strings) in a fresh repository. */
function fixtureRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aw-e2e-j10-')));
  cpSync('live/fixtures/ts-stats', dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/**
 * Nobody watches the run: in the app window, open permission requests are allowed once and blocking questions
 * answered (as in live/), those already open and each one announced by `inbox.updated` afterwards.
 */
async function playTheUser(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${window.aw?.apiToken ?? ''}`, 'Content-Type': 'application/json' };
    type Item = { id: string; kind: string; status: string; payload: { blocking?: boolean } };
    const answer = (item: Item) => {
      const response =
        item.kind === 'permission'
          ? { decision: 'once' }
          : item.kind === 'question' && item.payload.blocking === true
            ? { answer: '按你的判断选择最合理的做法，并在结果中写明。' }
            : undefined;
      if (item.status !== 'open' || response === undefined) return;
      void fetch(`/api/v1/inbox/${item.id}/resolve`, { method: 'POST', headers, body: JSON.stringify({ response }) });
    };
    const events = new EventSource(`/api/v1/events?token=${encodeURIComponent(window.aw?.apiToken ?? '')}`);
    events.addEventListener('inbox.updated', (m) => answer(JSON.parse(m.data).item));
    const open: { items: Item[] } = await (await fetch('/api/v1/inbox?status=open', { headers })).json();
    for (const item of open.items) answer(item);
  });
}

test('J10 打包应用：引导页 → 添加项目 → 修 Bug 到结果卡；执行中退出重开 → 任务继续完成', async ({ request }) => {
  test.setTimeout(TASK_TIMEOUT_MS + 5 * 60_000);
  let app = await launch();
  let page = await app.firstWindow();

  // First launch: onboarding with the real environment.
  await expect(page.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  for (const check of ['Git', 'opencode 1.19.0', '可用的模型']) {
    await expect(page.getByTestId(`check-${check}`)).toContainText('已就绪', { timeout: 60_000 });
  }
  await page.screenshot({ path: join(SHOTS, 'onboarding.png') });
  await page.getByLabel('仓库目录').fill(fixtureRepo());
  await page.getByRole('button', { name: '添加项目' }).click();
  await expect(page.getByRole('heading', { name: '今天想让 AI 做什么？' })).toBeVisible();

  let api = await backend(page);
  const settings = await request.patch(`${api.base}/settings`, {
    headers: api.headers,
    data: { 'ai.defaultModel': TEST_MODEL },
  });
  expect(settings.ok()).toBe(true);

  await page
    .getByRole('group', { name: '流程' })
    .getByRole('button', { name: /修 Bug/ })
    .click();
  await page
    .getByLabel('需求')
    .fill('median 返回了错误的结果：median([10, 9, 1]) 应该是 9，实际是 10。请找到原因并修复。');
  await page.getByRole('button', { name: /^开始/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/);
  const taskId = new URL(page.url()).pathname.split('/').at(-1) ?? '';

  // Quit while the first step's session is running, then start again on the same data.
  await expect(page.getByTestId('step-locate')).toContainText('进行中', { timeout: 120_000 });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '今天想让 AI 做什么？' })).toBeVisible();
  api = await backend(page);
  await playTheUser(page);
  await page.getByRole('navigation').getByRole('link', { name: '任务', exact: true }).click();
  await page
    .getByRole('link', { name: /median/ })
    .first()
    .click();
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('检查全部通过', { timeout: TASK_TIMEOUT_MS });
  await expect(result).toContainText('src/stats.ts');
  await page.screenshot({ path: join(SHOTS, 'result-card.png') });

  // The session cut off by quitting ended as interrupted and its step ran again.
  const task = await (await request.get(`${api.base}/tasks/${taskId}`, { headers: api.headers })).json();
  const locate = task.nodes.find((n: { key: string }) => n.key === 'locate');
  const node = await (
    await request.get(`${api.base}/tasks/${taskId}/nodes/${locate.id}`, { headers: api.headers })
  ).json();
  expect(node.attempts.map((a: { status: string }) => a.status)).toContain('interrupted');
  await app.close();
});
