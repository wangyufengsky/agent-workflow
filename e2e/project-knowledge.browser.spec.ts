import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createProject, type FakeStep, patchSettings, queueResearchTurn } from './helpers.ts';

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

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

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
  // Folded once answered: one read, open shows the stages and what was read.
  const process = turn.getByTestId('research-process');
  await expect(process).toContainText('研究过程 · 读取 1 份原文');
  await process.locator('summary').click();
  await expect(process).toContainText('检索 1 次');
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
