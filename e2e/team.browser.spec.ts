import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

// Journey J35 (07 §5): the team page of a project whose history has three people, one of them with two emails.
// Dates are days before today, so that every commit falls in the default period (the last 30 days).

const DAY_MS = 86_400_000;

function commitAs(repo: string, author: string, daysAgo: number, message: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), content);
  }
  const date = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd: repo });
  git('add', '-A');
  git('commit', '-q', `--author=${author}`, `--date=${date}`, '-m', message);
}

const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;

test('J35 团队：成员表默认按姓名、点列头排序，成员页纵向趋势，合并身份后数字合并，四主题无报错', async ({
  page,
  request,
}) => {
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const project = await createProject(request, null);
  const repo = project.repoPath;
  commitAs(repo, 'Wang Wu <ww@corp.com>', 9, 'feat: one', { 'src/w.ts': lines(3) });
  commitAs(repo, 'Zhang San <zs@corp.com>', 8, 'feat: add a', { 'src/a.ts': lines(10), 'src/a.test.ts': lines(4) });
  commitAs(repo, 'Zhang San <zs@corp.com>', 6, 'fix: a', { 'src/a.ts': lines(12) });
  commitAs(repo, 'Zhang San <zs@corp.com>', 5, 'test: more', { 'src/a.test.ts': lines(6) });
  commitAs(repo, 'Zhang San <zs@home.com>', 4, '修复 b', { 'src/b.ts': lines(2) });
  commitAs(repo, 'Li Si <ls@corp.com>', 3, 'docs: readme', { 'docs/x.md': lines(5) });
  commitAs(repo, 'Li Si <ls@corp.com>', 2, 'feat: x', { 'src/x.ts': lines(6) });

  await page.goto(`/team/${project.id}`);
  const table = page.getByTestId('team-members');
  const names = () => table.getByTestId('member-name').allInnerTexts();
  // The two emails of Zhang San are two members until they are merged.
  await expect(table.locator('tbody tr')).toHaveCount(5);
  // By name by default, the e2e author of the first commit included.
  expect(await names()).toEqual(['e2e', 'Li Si', 'Wang Wu', 'Zhang San', 'Zhang San']);
  await table.getByRole('button', { name: '提交', exact: true }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Zhang San');
  await expect(table.locator('tbody tr').first().locator('td').nth(1)).toHaveText('3');

  // Zhang San's work email: three commits; of the two changing code, one changes tests too.
  await table
    .getByRole('button', { name: /Zhang San/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/members\/zs(%40|@)corp\.com/);
  const metrics = page.getByTestId('member-metrics');
  await expect(metrics).toContainText('测试伴随率');
  await expect(metrics).toContainText('50%');
  await expect(page.getByTestId('member-commits').locator('tr')).toHaveCount(3);

  // Merge the home email into the work email from the home email's page.
  await page.goto(`/team/${project.id}/members/${encodeURIComponent('zs@home.com')}`);
  await page.getByRole('button', { name: '合并到…' }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('zs@corp.com');
  await page.getByRole('dialog').getByRole('button', { name: '合并' }).click();
  await expect(page).toHaveURL(/\/members\/zs(%40|@)corp\.com/);
  await expect(page.getByTestId('member-commits').locator('tr')).toHaveCount(4);
  await page.getByRole('link', { name: '团队' }).first().click();
  await expect(table.locator('tbody tr')).toHaveCount(4);

  // Pro mode adds how lines are counted.
  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.reload();
  await page.getByRole('button', { name: '统计口径' }).click();
  await expect(page.getByTestId('team-settings')).toContainText('不计行数的文件');
  await page.keyboard.press('Escape');

  for (const theme of ['deepseek', 'warm', 'spdb', 'github_white']) {
    await patchSettings(request, { 'ui.theme': theme });
    await page.goto(`/team/${project.id}?period=last_90_days`);
    await expect(page.getByTestId('team-members')).toBeVisible();
    await expect(page.getByTestId('team-compare')).toBeVisible();
  }
  expect(errors).toEqual([]);
  await patchSettings(request, { 'ui.mode': 'simple' });
});
