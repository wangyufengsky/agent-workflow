import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { designSchema, GitReviewTarget, gitReviewSchema, McpToolName, OPENCODE_AGENT_NAME, ThemeId } from '@aw/shared';
import { type APIRequestContext, type APIResponse, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  type E2EProject,
  git,
  patchSettings,
  queueCodeReviewerTurn,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';
import { createPptFromSource } from './ppt-source-journey.ts';

const path = 'fee.ts';
const compare = '直连双端点 · 非 merge-base';
const summary = '计费规则改为新版额度，需要复核跨版本退款。';
const section = '清分计费模块';

test('从分支页打开分叉端点对比，查看冻结源码并离线阅读报告', async ({ request, page, browser }) => {
  test.setTimeout(60_000);
  await patchSettings(request, { 'ui.theme': 'default', 'ui.mode': 'pro' });
  await page.setViewportSize({ width: 1600, height: 1050 });
  const project = await createProject(request, null);
  const commit = (value: string) => {
    writeFileSync(join(project.repoPath, path), `export const rate = "${value}";\n`);
    git(project.repoPath, 'add', path);
    git(project.repoPath, 'commit', '-m', value);
    return git(project.repoPath, 'rev-parse', 'HEAD');
  };
  const base = commit('shared-base');
  git(project.repoPath, 'checkout', '-b', 'fee-old');
  const from = commit('old-amount');
  git(project.repoPath, 'checkout', '-b', 'fee-new', base);
  const to = commit('new-amount');
  commit('live-worktree');

  const enqueue = async (note: string) =>
    queueCodeReviewerTurn(request, project, [
      {
        type: 'callTool',
        name: McpToolName.SubmitFindings,
        args: {
          findings: [],
          summary: note,
          regression_checks: ['验证跨版本退款读取原单的计费额度'],
          comparison: {
            fromMatch: 'missing',
            toMatch: 'missing',
            summary: note,
            sections: [
              { title: section, status: 'modified', fromPath: path, toPath: path, detail: '新旧额度不同。' },
              { title: '计费入口保持稳定', status: 'unchanged', fromPath: path, toPath: path },
            ],
            transactions: [{ title: '跨版本退款口径', status: 'uncertain', toPath: path, detail: '需要进一步验证。' }],
          },
        },
      },
    ]);

  await enqueue(summary);
  await page.goto(`/git/${project.id}?view=branches`);
  await page.getByLabel('从', { exact: true }).fill('fee-old');
  await page.getByLabel('到', { exact: true }).fill(to);
  await page.getByRole('button', { name: compare, exact: true }).click();
  const view = page.getByRole('region', { name: '双版本端点对比', exact: true });
  await expect(view).toContainText(summary, { timeout: TASK_RUN_TIMEOUT_MS });
  const url = page.url();
  const id = new URL(url).searchParams.get('review');
  expect(id).toBeTruthy();
  const response = await request.get(`${API_BASE}/git/reviews/${id}`, { headers: AUTH });
  expect(response.ok(), await response.text()).toBe(true);
  const review = gitReviewSchema.parse(await response.json());
  expect(review).toMatchObject({ target: GitReviewTarget.Compare, from, to });
  await expect(view.getByText(from, { exact: true })).toBeVisible();
  await expect(view.getByText(to, { exact: true })).toBeVisible();
  await expect(view.getByText('无设计快照', { exact: true })).toHaveCount(2);
  await expect(view.getByText('＝ 未变', { exact: true })).toBeVisible();
  await expect(view.getByText('？ 待确认', { exact: true })).toBeVisible();

  await view.getByRole('button', { name: new RegExp(section) }).click();
  const oldSide = view.getByRole('region', { name: '旧版 · from', exact: true });
  const newSide = view.getByRole('region', { name: '新版 · to', exact: true });
  await expect(oldSide).toContainText('old-amount');
  await expect(newSide).toContainText('new-amount');
  await expect(view).not.toContainText('shared-base');
  await expect(view).not.toContainText('live-worktree');

  await patchSettings(request, { 'ui.theme': 'codex' });
  await page.reload();
  await expect(view.getByRole('region', { name: '新版 · to', exact: true })).toContainText('new-amount');
  await view.getByRole('button', { name: /跨版本退款口径/ }).click();
  await expect(view.getByText('此版本无对应文件。')).toBeVisible();
  await expect(newSide).toContainText('new-amount');
  await page.getByRole('tab', { name: /回归建议/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('验证跨版本退款读取原单的计费额度');

  const targetDir = mkdtempSync(join(tmpdir(), 'git-comparison-html-'));
  const offline = await browser.newContext({ offline: true });
  try {
    await page.getByRole('button', { name: '导出离线对比 HTML', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导出离线对比 HTML', exact: true });
    await dialog.getByRole('textbox', { name: '导出目录' }).fill(targetDir);
    await dialog.getByRole('button', { name: '导出', exact: true }).click();
    await expect(page.getByText(/已导出离线 HTML/)).toBeVisible();

    const report = await offline.newPage();
    await report.setViewportSize({ width: 1600, height: 1050 });
    await report.goto(pathToFileURL(join(targetDir, 'index.html')).href);
    await expect(report.getByRole('heading', { name: /双版本端点对比/ }).first()).toBeVisible();
    await expect(report.getByText(summary, { exact: true }).first()).toBeVisible();
    await expect(report.getByText(section, { exact: true })).toBeVisible();
    await expect(report.getByText('？ 待确认', { exact: true })).toBeVisible();
    await expect(report.getByText(from, { exact: true })).toBeVisible();
    await expect(report.getByText(to, { exact: true })).toBeVisible();
    await report.getByLabel('主题').selectOption('light');
    await report.screenshot({ path: 'screenshots/phase3-comparison-offline.png', animations: 'disabled' });
  } finally {
    await offline.close();
    rmSync(targetDir, { recursive: true });
  }

  const rerun = '重跑后仍保留原双端点。';
  await enqueue(rerun);
  await page.goto(url);
  await page.getByRole('button', { name: '重新审查' }).click();
  await expect(view).toContainText(rerun, { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(view.getByText(from, { exact: true })).toBeVisible();
  await expect(view.getByText(to, { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('review')).not.toBe(id);
  await page.getByRole('combobox', { name: 'AI 审查' }).selectOption(review.id);
  await expect(view).toContainText(summary);
});

async function loadBody(response: APIResponse) {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function buildDesign(request: APIRequestContext, project: E2EProject, ref: string) {
  const transaction = 'T301 商户收单清算';
  const draft = designSchema.parse(
    await loadBody(
      await request.post(`${API_BASE}/designs`, {
        headers: AUTH,
        data: { projectId: project.id },
      }),
    ),
  );
  const url = `${API_BASE}/designs/${draft.id}`;
  const design = designSchema.parse(
    await loadBody(
      await request.put(`${url}/outline`, {
        headers: AUTH,
        data: { sections: [{ kind: 'module', title: section, scopePaths: [path] }] },
      }),
    ),
  );
  const [chapter] = design.sections;
  if (chapter === undefined) throw new Error('缺少测试设计的计费章节');
  const evidence = { evidenceClass: 'static', relPath: path, lineStart: 1, lineEnd: 1 };
  const scripted = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: {
      match: { directory: project.repoPath, agent: OPENCODE_AGENT_NAME.designer },
      steps: [
        {
          type: 'callTool',
          name: McpToolName.SubmitDesignSection,
          args: {
            sectionId: chapter.id,
            summary: '清分系统按交易金额计算费用。',
            blocks: [
              {
                type: 'transaction',
                code: 'T301',
                channel: 'POS',
                version: '1',
                title: transaction,
                diagramId: 'settle',
                evidence: [evidence],
              },
              { type: 'transaction', code: 'T309', title: '跨行退货核算', diagramId: 'refund', evidence: [evidence] },
            ],
            files: [{ relPath: path, responsibility: '计算清分手续费。', symbols: [] }],
            diagrams: [
              {
                id: 'settle',
                kind: 'business_flow',
                title: transaction,
                nodes: [{ id: 'settle-fee', label: '计算清分费用', targetKind: 'file', relPath: path }],
                edges: [],
              },
              {
                id: 'refund',
                kind: 'business_flow',
                title: '跨行退货核算',
                nodes: [{ id: 'refund-fee', label: '读取原单额度', targetKind: 'file', relPath: path }],
                edges: [],
              },
            ],
          },
        },
      ],
    },
  });
  expect(scripted.ok(), await scripted.text()).toBe(true);
  const started = await request.post(`${url}/generate`, { headers: AUTH, data: { model: null } });
  expect(started.ok(), await started.text()).toBe(true);
  await expect
    .poll(
      async () => {
        const current = designSchema.parse(await loadBody(await request.get(url, { headers: AUTH })));
        expect(current.sourceSnapshot).toMatchObject({ commitSha: ref, dirty: false });
        return current.status;
      },
      { timeout: TASK_RUN_TIMEOUT_MS },
    )
    .toBe('ready');
  return draft.id;
}

test('真实双快照的架构与交易对齐在明暗主题下展示', async ({ request, page }, info) => {
  test.setTimeout(60_000);
  await patchSettings(request, { 'ui.theme': 'default', 'ui.mode': 'pro' });
  await page.setViewportSize({ width: 1600, height: 1050 });
  const project = await createProject(request, null);
  const commit = (useBankersRounding: boolean) => {
    writeFileSync(
      join(project.repoPath, path),
      [
        'export function calculateFee(amount: number, tier: number) {',
        '  const fee = amount * tier / 100;',
        useBankersRounding ? '  return roundHalfEven(fee);' : '  return Math.round(fee);',
        '}',
        '',
        ...(useBankersRounding
          ? [
              'function roundHalfEven(value: number) {',
              '  const whole = Math.floor(value);',
              '  return value - whole === 0.5 && whole % 2 === 0',
              '    ? whole',
              '    : Math.round(value);',
              '}',
            ]
          : []),
        '',
      ].join('\n'),
    );
    git(project.repoPath, 'add', path);
    git(project.repoPath, 'commit', '-m', useBankersRounding ? 'Use ties-to-even rounding' : 'Use nearest rounding');
    return git(project.repoPath, 'rev-parse', 'HEAD');
  };

  const from = commit(false);
  const fromDesignId = await buildDesign(request, project, from);
  const to = commit(true);
  const toDesignId = await buildDesign(request, project, to);
  const note = '日终清分切换到半偶舍入。优先回归商户收单的半数边界与跨行退货对账。';
  await queueCodeReviewerTurn(request, project, [
    {
      type: 'callTool',
      name: McpToolName.SubmitFindings,
      args: { findings: [], summary: note, regression_checks: ['跨行退货应按原单版本重新计算费用'] },
    },
  ]);
  const review = gitReviewSchema.parse(
    await loadBody(
      await request.post(`${API_BASE}/projects/${project.id}/git/reviews`, {
        headers: AUTH,
        data: { target: { kind: GitReviewTarget.Compare, from, to } },
      }),
    ),
  );
  expect(review.comparison).toMatchObject({ fromDesignId, toDesignId, fromMatch: 'exact', toMatch: 'exact' });

  await page.goto(`/git/${project.id}?view=review&review=${review.id}`);
  const view = page.getByRole('region', { name: '双版本端点对比', exact: true });
  await expect(view).toContainText(note, { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(view.getByText('精确匹配快照', { exact: true })).toHaveCount(2);
  await expect(view.getByRole('button', { name: /修改.*T301 商户收单清算/ })).toBeVisible();
  await expect(view.getByRole('button', { name: /待确认.*跨行退货核算/ })).toBeVisible();
  const viewSource = async () => {
    await view.getByRole('button', { name: new RegExp(section) }).click();
    await expect(view.getByRole('region', { name: '旧版 · from' })).toContainText('Math.round');
    await expect(view.getByRole('region', { name: '新版 · to' })).toContainText('roundHalfEven');
  };
  await viewSource();
  await page.screenshot({ path: 'screenshots/phase3-comparison-dark.png', animations: 'disabled' });
  await patchSettings(request, { 'ui.theme': 'codex' });
  await page.reload();
  await viewSource();
  await page.screenshot({ path: 'screenshots/phase3-comparison-light.png', animations: 'disabled' });

  await patchSettings(request, { 'ui.theme': ThemeId.Default });
  await createPptFromSource(page, request, info, project, {
    kind: 'git_review',
    refId: review.id,
    title: review.label,
    theme: ThemeId.Default,
    brief: /双版本发版评审/,
  });
});
