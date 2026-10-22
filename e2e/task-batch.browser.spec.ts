import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createProject,
  GIT_HEAVY_SPECS_SLOW,
  git,
  passReview,
  patchSettings,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journey J17 (07 §5, 20): unit tests for three directories as one batch, then one click merges them all.

test.slow(GIT_HEAVY_SPECS_SLOW, 'three task runs and merges (17 §4.1)');

test.beforeEach(({ request }) =>
  patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple', 'delivery.defaultStrategy': 'squash' }),
);

test('J17 主页「补单元测试」的「批量」→ 选 3 个目录 → 三个任务各自跑完 → 合并全部 → 主分支 3 个提交', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  const modules = ['order', 'payment', 'user'];
  for (const name of modules) {
    mkdirSync(join(project.repoPath, 'src', name), { recursive: true });
    writeFileSync(join(project.repoPath, 'src', name, 'index.ts'), `export const ${name} = true;\n`);
  }
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'add modules');
  // Each task analyses, writes a test of its own and passes review; the tasks take the queued turns in turn.
  for (const name of modules) {
    await queueTurn(request, project, { title: '分析测试缺口' }, [submitResult(`列出了 ${name} 缺少的测试`)]);
    await queueTurn(request, project, { title: '编写测试' }, [
      { type: 'edit', file: `src/${name}/index.test.ts`, content: `// tests of ${name}\n` },
      submitResult(`补了 ${name} 的测试`),
    ]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  }

  await page.goto(`/?projectId=${project.id}`);
  // Batch and schedule entries belong to「开始任务」mode of a fixed workflow (D111).
  await page.getByRole('group', { name: '直接开始' }).getByRole('button', { name: '补单元测试' }).click();
  await page.getByRole('link', { name: '批量运行「补单元测试」' }).click();
  await expect(page.getByRole('heading', { name: '新建批量任务' })).toBeVisible();
  await expect(page.getByLabel('需求模板')).toHaveValue('为 {{target}} 补充单元测试，覆盖主要行为与边界情况。');

  await page.getByRole('button', { name: '进入 src' }).click();
  for (const name of modules) await page.getByRole('checkbox', { name: `选择 src/${name}/` }).check();
  await expect(page.getByTestId('batch-selected')).toHaveText('已选 3 个目标');
  await expect(page.getByTestId('batch-preview')).toHaveText('为 src/order/ 补充单元测试，覆盖主要行为与边界情况。');
  // The lines tab shows what was ticked.
  await page.getByRole('tab', { name: '按行输入' }).click();
  await expect(page.getByLabel('目标（每行一个）')).toHaveValue('src/order/\nsrc/payment/\nsrc/user/');

  await page.getByRole('button', { name: /^创建 3 个任务/ }).click();
  await expect(page.getByTestId('batch-page')).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  const rows = page.getByTestId('batch-item');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('src/order/');
  // The three tasks run on their own until each waits to be merged.
  await expect(page.getByTestId('batch-progress')).toContainText('待合并 3', { timeout: 3 * TASK_RUN_TIMEOUT_MS });

  await page.getByRole('button', { name: '合并全部待合并的（3）' }).click();
  const dialog = page.getByRole('dialog', { name: '合并 3 个任务？' });
  await expect(dialog).toContainText('将依次合并到 main');
  await dialog.getByRole('button', { name: '合并' }).click();
  await expect(page.getByRole('status')).toContainText('已完成 3 个', { timeout: 3 * TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('batch-progress')).toContainText('已全部结束');
  await expect(page.getByRole('button', { name: '合并全部待合并的（0）' })).toBeDisabled();

  const subjects = git(project.repoPath, 'log', '--format=%s', 'main').split('\n');
  expect(subjects.slice(0, 3).sort()).toEqual(
    modules.map((name) => expect.stringMatching(new RegExp(`^为 src/${name}/ 补充单元测试`))),
  );
  expect(git(project.repoPath, 'ls-tree', '-r', '--name-only', 'main', 'src').split('\n')).toEqual(
    modules.flatMap((name) => [`src/${name}/index.test.ts`, `src/${name}/index.ts`]),
  );
});
