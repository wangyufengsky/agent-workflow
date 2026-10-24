import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  appTool,
  createProject,
  type FakeStep,
  patchSettings,
  queueAssistantTurn,
  queueResearchTurn,
} from './helpers.ts';

// J12 (K-09): a question about a project, its research, an answer with citations, the cited source, a follow-up and
// the history. The researcher's turns are played by FakeOpencode in the project repository. The file name sorts after
// onboarding.browser.spec.ts, which needs the shared backend without any project.

const REFUND = [
  'export function refund(amount: number, fee: number) {',
  '  const net = amount - fee;',
  '  return Math.round(net * 100) / 100;',
  '}',
  '',
].join('\n');

const answer = (text: string, citations: Array<Record<string, unknown>>): FakeStep => ({
  type: 'callTool',
  name: 'submit_answer',
  args: { answer: text, citations },
});
const file = (path: string, start: number, end: number) => ({
  type: 'file',
  path,
  start_line: start,
  end_line: end,
});

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

test('J12 提问 → 研究过程 → 带引用的回答 → 点击引用看原文 → 续问 → 对话记录', async ({ page, request }) => {
  const project = await createProject(request, null);
  mkdirSync(join(project.repoPath, 'src'));
  writeFileSync(join(project.repoPath, 'src/refund.ts'), REFUND);
  writeFileSync(join(project.repoPath, 'README.md'), '# Shop\n\nRefunds are rounded to cents.\n');
  await queueResearchTurn(request, project, [
    { type: 'tool', tool: 'grep', input: { pattern: 'Math.round' } },
    { type: 'tool', tool: 'read', input: { filePath: join(project.repoPath, 'src/refund.ts') } },
    answer('退款在 `refund()` 中四舍五入到分 [1]，README 也这样说明 [2]。', [
      file('src/refund.ts', 2, 3),
      file('README.md', 3, 3),
    ]),
  ]);

  await page.goto(`/knowledge?projectId=${project.id}`);
  await expect(page.getByRole('heading', { name: '关于这个项目，你想了解什么？' })).toBeVisible();
  await expect(page.getByText(/将从 代码 · 文档 中查找依据 · 网络检索关闭/)).toBeVisible();
  await page.getByLabel('向项目提问').fill('退款金额在哪里四舍五入？');
  await page.getByLabel('向项目提问').press('Enter');

  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+/);
  const turn = page.getByTestId('knowledge-turn').first();
  await expect(turn).toContainText('退款金额在哪里四舍五入？');
  await expect(turn.getByRole('button', { name: '引用 1' })).toBeVisible();
  // Folded once answered: one read; open shows what the researcher did, the calls in a row folded (25 §4.3).
  const process = turn.getByTestId('research-process');
  const toggle = process.getByRole('button', { name: /研究过程/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(process).toContainText('读取 1 份原文');
  await toggle.click();
  await process.getByTestId('stream-group').getByRole('button').click();
  await expect(process).toContainText('搜索Math.round');
  await expect(process).toContainText('src/refund.ts');

  await turn.getByRole('button', { name: '引用 1' }).click();
  const panel = page.getByRole('complementary', { name: '引用原文' });
  await expect(panel).toContainText('src/refund.ts · 第 2–3 行');
  const lines = panel.getByTestId('citation-lines');
  await expect(lines.locator('[data-cited="true"]')).toHaveCount(2);
  await expect(lines.locator('[data-cited="true"]').last()).toContainText('Math.round(net * 100) / 100');
  await expect(turn.getByRole('button', { name: '引用 1' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: '下一处' }).click();
  await expect(panel).toContainText('README.md · 第 3 行');
  await expect(lines.locator('[data-cited="true"]')).toHaveText(/Refunds are rounded to cents\./);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await queueResearchTurn(request, project, [
    answer('手续费 `fee` 先从金额中扣除 [1]。', [file('src/refund.ts', 2, 2)]),
  ]);
  await page.getByLabel('向项目提问').fill('手续费在四舍五入之前还是之后扣？');
  await page.getByLabel('向项目提问').press('Enter');
  const second = page.getByTestId('knowledge-turn').nth(1);
  await expect(second).toContainText('手续费 fee 先从金额中扣除');
  await expect(page.getByText(/将从 代码 · 文档 中查找依据/)).toBeVisible();

  await page.getByRole('link', { name: '对话记录' }).click();
  const row = page.getByTestId('knowledge-history-row').filter({ hasText: '退款金额在哪里四舍五入？' });
  await expect(row).toContainText('2 轮');
  await expect(row).toContainText('1 处引用');
  await row.click();
  await expect(page.getByTestId('knowledge-turn')).toHaveCount(2);
});

test('J13 对助手提问 → 正在查资料 → 带引用的回答 → 点引用看原文 → 卡片打开知识问答对话', async ({ page, request }) => {
  const project = await createProject(request, null);
  mkdirSync(join(project.repoPath, 'src'));
  writeFileSync(join(project.repoPath, 'src/refund.ts'), REFUND);
  await queueAssistantTurn(request, [
    appTool('knowledge_ask', {
      projectId: project.id,
      question: '退款在哪里四舍五入？',
      sources: { code: true, docs: true, database: false, web: false },
    }),
    { type: 'text', text: '我去查一下资料，稍等。' },
  ]);
  // The researcher waits for a permission until the assistant's next turn is queued: that turn needs the ids.
  await queueResearchTurn(request, project, [
    { type: 'tool', tool: 'read', input: { filePath: join(project.repoPath, 'src/refund.ts') } },
    { type: 'permission', permission: 'bash', patterns: ['ls src'] },
    answer('退款在 `refund()` 中四舍五入到分 [1]。', [file('src/refund.ts', 3, 3)]),
  ]);

  // Away from home, where ⌘J goes to the page's own input (D112).
  await page.goto('/settings');
  // The shell's shortcuts listen once the page has rendered.
  await expect(page.getByRole('main').getByRole('heading', { name: '设置' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  await panel.getByLabel('发给助手的消息').fill('退款在哪里四舍五入？');
  await panel.getByLabel('发给助手的消息').press('ControlOrMeta+Enter');
  await expect(panel).toContainText('我去查一下资料，稍等。');

  const list = await (
    await request.get(`${API_BASE}/knowledge/conversations?projectId=${project.id}`, { headers: AUTH })
  ).json();
  const id: string = list.items[0].id;
  const detail = await (await request.get(`${API_BASE}/knowledge/conversations/${id}`, { headers: AUTH })).json();
  const turnId: string = detail.turns[0].id;
  await queueAssistantTurn(request, [
    {
      type: 'text',
      text: `退款在 \`refund()\` 中四舍五入到分 [[1]](/knowledge/${id}?turn=${turnId}&cite=1)。[在知识问答中查看](/knowledge/${id})`,
    },
  ]);
  const inbox = await (await request.get(`${API_BASE}/inbox?status=open`, { headers: AUTH })).json();
  const permission = inbox.items.find(
    (item: { kind: string; payload: { patterns?: string[] } }) =>
      item.kind === 'permission' && item.payload.patterns?.includes('ls src'),
  );
  const resolved = await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
    headers: AUTH,
    data: { response: { decision: 'once' } },
  });
  expect(resolved.ok()).toBe(true);

  const card = panel.getByTestId('entity-card');
  await expect(card).toContainText('知识问答对话');
  await expect(card).toContainText('退款在哪里四舍五入？');
  await expect(panel).toContainText('退款在 refund() 中四舍五入到分');
  await panel.getByRole('link', { name: '引用 1' }).click();
  const source = page.getByRole('complementary', { name: '引用原文' });
  await expect(source.getByTestId('citation-lines').locator('[data-cited="true"]')).toContainText('Math.round');
  await expect(panel).toBeVisible();

  await card.getByRole('button', { name: '打开' }).click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${id}$`));
  await expect(page.getByTestId('knowledge-turn')).toContainText('退款在 refund() 中四舍五入到分');
  // Later specs open the panel on the most recent conversation: leave none behind.
  const conversations = await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json();
  for (const c of conversations.items) {
    await request.delete(`${API_BASE}/assistant/conversations/${c.id}`, { headers: AUTH });
  }
});

test('J14 回答流式出现：引用先待核对、提交通过后可点击；换模型续问，对话与记录显示模型', async ({ page, request }) => {
  const project = await createProject(request, null);
  mkdirSync(join(project.repoPath, 'src'));
  writeFileSync(join(project.repoPath, 'src/refund.ts'), REFUND);
  const text = '退款在 `refund()` 中四舍五入到分 [1]。';
  // The permission holds the turn after the draft is written, before the answer is submitted.
  await queueResearchTurn(request, project, [
    { type: 'tool', tool: 'read', input: { filePath: join(project.repoPath, 'src/refund.ts') } },
    { type: 'text', text },
    { type: 'permission', permission: 'bash', patterns: ['ls src/refund'] },
    answer(text, [file('src/refund.ts', 3, 3)]),
  ]);

  await page.goto(`/knowledge?projectId=${project.id}`);
  await page.getByLabel('模型').selectOption({ label: 'Fake Model 2' });
  await page.getByLabel('向项目提问').fill('退款金额怎样取整？');
  await page.getByLabel('向项目提问').press('Enter');

  const turn = page.getByTestId('knowledge-turn').first();
  const draft = turn.getByTestId('answer-draft');
  await expect(draft).toContainText('退款在 refund() 中四舍五入到分');
  await expect(draft).toContainText('正在写回答 · 引用待核对');
  await expect(draft.getByTitle(/待核对/)).toHaveText('1');
  await expect(turn.getByRole('button', { name: '引用 1' })).toHaveCount(0);
  await expect(turn).toContainText('opencode/fake-model-2');

  const inbox = await (await request.get(`${API_BASE}/inbox?status=open`, { headers: AUTH })).json();
  const permission = inbox.items.find(
    (item: { kind: string; payload: { patterns?: string[] } }) =>
      item.kind === 'permission' && item.payload.patterns?.includes('ls src/refund'),
  );
  await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
    headers: AUTH,
    data: { response: { decision: 'once' } },
  });
  await expect(turn.getByRole('button', { name: '引用 1' })).toBeVisible();
  await expect(draft).toHaveCount(0);

  await queueResearchTurn(request, project, [answer('手续费先扣 [1]。', [file('src/refund.ts', 2, 2)])]);
  await expect(page.getByLabel('模型')).toHaveValue('opencode/fake-model-2');
  await page.getByLabel('模型').selectOption({ label: 'Fake Model' });
  await page.getByLabel('向项目提问').fill('手续费什么时候扣？');
  await page.getByLabel('向项目提问').press('Enter');
  const second = page.getByTestId('knowledge-turn').nth(1);
  await expect(second.getByRole('button', { name: '引用 1' })).toBeVisible();
  await expect(second).toContainText('opencode/fake-model');
  await expect(second).not.toContainText('fake-model-2');

  // Straight to another conversation on the same route (as an in-app link does): its picker follows its latest turn.
  await queueResearchTurn(request, project, [answer('先扣手续费 [1]。', [file('src/refund.ts', 2, 2)])]);
  const other = await (
    await request.post(`${API_BASE}/knowledge/conversations`, {
      headers: AUTH,
      data: {
        projectId: project.id,
        question: '手续费在哪里扣？',
        sources: { code: true, docs: true, database: false, web: false },
        model: 'opencode/fake-model-2',
      },
    })
  ).json();
  const here = new URL(page.url()).pathname;
  const goInApp = (path: string) =>
    page.evaluate((to) => {
      window.history.pushState({}, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  // Both conversations cached first, then back to the other one.
  await goInApp(`/knowledge/${other.id}`);
  await expect(page.getByTestId('knowledge-turn').first()).toContainText('手续费在哪里扣？');
  await goInApp(here);
  await expect(page.getByLabel('模型')).toHaveValue('opencode/fake-model');
  await goInApp(`/knowledge/${other.id}`);
  await expect(page.getByTestId('knowledge-turn').first()).toContainText('手续费在哪里扣？');
  await expect(page.getByLabel('模型')).toHaveValue('opencode/fake-model-2');
  await goInApp(here);

  await page.getByRole('link', { name: '对话记录' }).click();
  const row = page.getByTestId('knowledge-history-row').filter({ hasText: '退款金额怎样取整？' });
  await expect(row).toContainText('opencode/fake-model');
  await expect(row).not.toContainText('fake-model-2');
});

test('J31 研究员用浏览器读内网网页并引用：打开引用看到读到的正文摘录（29 §2.8）', async ({ page, request }) => {
  const site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<title>退款规范</title><h1>退款规范</h1><p>退款金额四舍五入到分，手续费先扣。</p>');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  const url = `http://127.0.0.1:${address.port}/refunds`;
  try {
    const project = await createProject(request, null);
    await queueResearchTurn(request, project, [
      { type: 'callTool', name: 'browser_open', args: { url } },
      answer('内网的退款规范写明四舍五入到分 [1]。', [{ type: 'web', url, title: '退款规范' }]),
    ]);
    const asked = await request.post(`${API_BASE}/knowledge/conversations`, {
      headers: AUTH,
      data: {
        projectId: project.id,
        question: '退款怎么取整？',
        sources: { code: true, docs: false, database: false, web: true },
      },
    });
    const conversation = await asked.json();

    await page.goto(`/knowledge/${conversation.id}`);
    const turn = page.getByTestId('knowledge-turn').first();
    await turn.getByRole('button', { name: '引用 1' }).click();
    const panel = page.getByRole('complementary', { name: '引用原文' });
    await expect(panel.getByRole('link', { name: '在浏览器中打开' })).toBeVisible();
    await expect(panel.getByTestId('page-excerpt')).toContainText('退款金额四舍五入到分，手续费先扣。');
  } finally {
    site.close();
  }
});
