import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DesignSectionKind,
  DesignStalenessState,
  DesignStatus,
  ErrorCode,
  GitFindingStatus,
  GitReviewTarget,
  getDesignOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
} from '@aw/shared';
import { type APIRequestContext, expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { API_BASE, AUTH } from './env.ts';
import { appTool, createProject, git, patchSettings, queueAssistantTurn } from './helpers.ts';

const sourcePath = 'fees.ts';
const sectionTitle = '清分计费';

async function prepareDesign(request: APIRequestContext) {
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, sourcePath), 'export const fee = 1;\n');
  git(project.repoPath, 'add', sourcePath);
  git(project.repoPath, 'commit', '-m', 'Record initial fee');
  const from = git(project.repoPath, 'rev-parse', 'HEAD');

  const created = await request.post(`${API_BASE}/designs`, {
    headers: AUTH,
    data: { projectId: project.id, aiReviewEnabled: false },
  });
  await expect(created).toBeOK();
  const { id, title } = getDesignOp.output.parse(await created.json());
  const url = `${API_BASE}/designs/${id}`;
  const outline = await request.put(`${url}/outline`, {
    headers: AUTH,
    data: {
      sections: [{ kind: DesignSectionKind.Module, title: sectionTitle, scopePaths: [sourcePath], selected: true }],
    },
  });
  await expect(outline).toBeOK();
  const [section] = getDesignOp.output.parse(await outline.json()).sections;
  if (section === undefined) throw new Error('Missing fee section');
  await expect(
    await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
      headers: AUTH,
      data: {
        match: { title, agent: OPENCODE_AGENT_NAME.designer },
        steps: [
          {
            type: 'callTool',
            name: McpToolName.SubmitDesignSection,
            args: {
              sectionId: section.id,
              summary: '每笔交易收取固定手续费。',
              blocks: [{ type: 'markdown', markdown: '每笔交易收取固定手续费。' }],
              files: [{ relPath: sourcePath, responsibility: '计算手续费', symbols: [] }],
              diagrams: [],
            },
          },
        ],
      },
    }),
  ).toBeOK();
  await expect(await request.post(`${url}/generate`, { headers: AUTH, data: {} })).toBeOK();
  const readDesign = async () => {
    const response = await request.get(url, { headers: AUTH });
    await expect(response).toBeOK();
    return getDesignOp.output.parse(await response.json());
  };
  await expect.poll(async () => (await readDesign()).status).toBe(DesignStatus.Ready);

  writeFileSync(join(project.repoPath, sourcePath), 'export const fee = 2;\n');
  git(project.repoPath, 'add', sourcePath);
  git(project.repoPath, 'commit', '-m', 'Adjust fee');
  return { project, id, section, from, to: git(project.repoPath, 'rev-parse', 'HEAD'), readDesign };
}

test('助手直接快查项目设计，版本对比和增量更新须确认，人工问题处置不可调用', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro', 'assistant.alwaysAllow': [] });
  const { project, id, section, from, to, readDesign } = await prepareDesign(request);
  await page.goto(`/?projectId=${project.id}`);
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  const stream = page.getByTestId('home-messages');
  const actions = stream.getByTestId('assistant-action');
  const cards = stream.getByTestId('confirmation-card');
  const ask = async (question: string) => {
    await input.fill(question);
    await input.press('ControlOrMeta+Enter');
  };

  await queueAssistantTurn(request, [
    appTool('designs_staleness', { id }),
    appTool('designs_lookupImpact', { id, paths: [sourcePath] }),
  ]);
  await ask('设计过期了吗？手续费文件的改动会影响什么？');

  const staleness = actions.filter({ hasText: '检查项目设计是否过期' });
  await expect(staleness).toHaveAttribute('data-state', 'done');
  await staleness.locator('summary').click();
  expect(JSON.parse(await staleness.locator('pre').last().innerText())).toMatchObject({
    state: DesignStalenessState.Stale,
    baseSha: from,
    headSha: to,
    changedFilesCount: 1,
    affectedSectionIds: [section.id],
  });
  const impact = actions.filter({ hasText: '按路径查询设计影响' });
  await expect(impact).toHaveAttribute('data-state', 'done');
  await impact.locator('summary').click();
  expect(JSON.parse(await impact.locator('pre').last().innerText())).toMatchObject({
    designId: id,
    snapshotSha: from,
    candidates: expect.arrayContaining([expect.objectContaining({ title: sectionTitle })]),
    uncoveredPaths: [],
  });
  await expect(cards).toHaveCount(0);

  await queueAssistantTurn(request, [
    appTool('gitReviews_start', { id: project.id, target: { kind: GitReviewTarget.Compare, from, to } }),
    appTool('designs_incrementalUpdate', { id, sectionIds: [section.id] }),
    appTool('gitReviews_updateFindingStatus', {
      reviewId: 'review',
      findingId: 'finding',
      status: GitFindingStatus.Accepted,
    }),
  ]);
  await ask('比较这两个版本，增量更新受影响的设计章节，并把代码问题标为已接受。');

  for (const title of ['AI 审查', '按变更增量更新项目设计']) {
    const card = cards.filter({ hasText: title });
    await expect(card).toContainText('等待确认');
    await expect(card.getByRole('button', { name: '确认', exact: true })).toBeEnabled();
  }
  const denied = actions.filter({ hasText: 'gitReviews_updateFindingStatus' });
  await expect(denied).toHaveAttribute('data-state', 'failed');
  await denied.locator('summary').click();
  expect(JSON.parse(await denied.locator('pre').last().innerText())).toMatchObject({
    code: ErrorCode.NotFound,
    message: 'Unknown tool gitReviews_updateFindingStatus',
  });
  await expect(cards).toHaveCount(2);

  const reviews = await request.get(`${API_BASE}/projects/${project.id}/git/reviews`, { headers: AUTH });
  await expect(reviews).toBeOK();
  expect(await reviews.json()).toMatchObject({ items: [] });
  expect(await readDesign()).toMatchObject({
    status: DesignStatus.Ready,
    sourceSnapshot: { commitSha: from },
  });
});
