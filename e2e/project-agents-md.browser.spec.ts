import { expect, test } from '@playwright/test';
import {
  createProject,
  git,
  passReview,
  patchSettings,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test('J44 AGENTS.md：项目详情没有时预览规则、写补充说明后让 AI 生成，合并后面板显示新内容（40）', async ({
  page,
  request,
}) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '梳理项目约定' }, [submitResult('没有构建文件')]);
  await queueTurn(request, project, { title: '编写 AGENTS.md' }, [
    { type: 'edit', file: 'AGENTS.md', content: '# AGENTS.md\n\n## 在 Agent Workflow 中工作\n\n- 不要自己提交。\n' },
    submitResult('写好了 AGENTS.md'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await page.goto(`/projects/${project.id}`);
  const panel = page.getByRole('region', { name: 'AGENTS.md' });
  await expect(panel).toContainText('默认分支 main 上还没有 AGENTS.md。');
  await panel.getByRole('button', { name: '预览这一节' }).click();
  await expect(panel.getByTestId('agents-md-rules')).toContainText('提交结果前运行项目的测试');
  await panel.getByLabel('补充说明（可选）').fill('提交信息用英文');
  await panel.getByRole('button', { name: '让 AI 生成' }).click();

  // The task page: generating it is a task like any other, reviewed and merged by the user (D202).
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByTestId('task-page')).toContainText('生成 AGENTS.md');
  const result = page.getByTestId('result-card');
  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  expect(git(project.repoPath, 'show', 'main:AGENTS.md')).toContain('## 在 Agent Workflow 中工作');

  await page.goto(`/projects/${project.id}`);
  await expect(panel).toContainText('默认分支 main 上的版本');
  await expect(panel.getByTestId('agents-md').getByRole('heading', { name: '在 Agent Workflow 中工作' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '让 AI 补充' })).toBeVisible();
});
