import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type DesignDTO,
  designSchema,
  encodeGitImpactTargetId,
  gitReviewSchema,
  McpToolName,
  OPENCODE_AGENT_NAME,
  ThemeId,
} from '@aw/shared';
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

const feePath = 'src/calc-fee.ts';
const settlePath = 'src/settle-batch.ts';
const feeSymbol = 'calculateFee';
const chapterTitle = '清分计费模块';
const moduleTitle = '计费子模块';
const transactionTitle = '商户收单清算';
const findingTitle = '折扣边界未覆盖';
const regression = '验证半数边界金额的分录与对账单';
const source = 'export const calculateFee = (amount: number) => Math.round(amount / 2);';

async function responseData(response: APIResponse): Promise<unknown> {
  expect(response.ok(), await response.text()).toBe(true);
  return response.status() === 204 ? undefined : response.json();
}

async function designFixture(request: APIRequestContext, project: E2EProject): Promise<DesignDTO> {
  const created = designSchema.parse(
    await responseData(
      await request.post(`${API_BASE}/designs`, {
        headers: AUTH,
        data: { projectId: project.id },
      }),
    ),
  );
  const url = `${API_BASE}/designs/${created.id}`;
  const outlined = designSchema.parse(
    await responseData(
      await request.put(`${url}/outline`, {
        headers: AUTH,
        data: { sections: [{ kind: 'module', title: chapterTitle, scopePaths: [feePath] }] },
      }),
    ),
  );
  const chapter = outlined.sections[0];
  if (chapter === undefined) throw new Error('缺少测试章节');
  const staticEvidence = { evidenceClass: 'static', relPath: feePath, lineStart: 1, lineEnd: 1 };
  await responseData(
    await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
      headers: AUTH,
      data: {
        match: { directory: project.repoPath, agent: OPENCODE_AGENT_NAME.designer },
        steps: [
          {
            type: 'callTool',
            name: McpToolName.SubmitDesignSection,
            args: {
              sectionId: chapter.id,
              summary: '日终清分按交易金额计算费用。',
              blocks: [
                {
                  type: 'submodule',
                  id: 'fee',
                  title: moduleTitle,
                  summary: '统一处理手续费。',
                  files: [feePath],
                  behaviors: [{ title: '计算费用', markdown: '对输入金额进行舍入。', evidence: [staticEvidence] }],
                },
                {
                  type: 'transaction',
                  title: transactionTitle,
                  code: 'T301',
                  diagramId: 'settlement',
                  evidence: [staticEvidence],
                },
              ],
              files: [
                {
                  relPath: feePath,
                  responsibility: '计算清分手续费。',
                  symbols: [
                    {
                      id: 'fee-round',
                      name: feeSymbol,
                      qualifiedName: feeSymbol,
                      kind: 'function',
                      lineStart: 1,
                      lineEnd: 1,
                      summary: '根据交易金额计算费用。',
                    },
                  ],
                },
              ],
              diagrams: [
                {
                  id: 'settlement',
                  kind: 'business_flow',
                  title: transactionTitle,
                  nodes: [
                    { id: 'round', label: '计算费用', targetKind: 'symbol', targetId: 'fee-round', relPath: feePath },
                  ],
                  edges: [],
                },
              ],
            },
          },
        ],
      },
    }),
  );
  await responseData(await request.post(`${url}/generate`, { headers: AUTH, data: { model: null } }));
  const load = async () => designSchema.parse(await responseData(await request.get(url, { headers: AUTH })));
  await expect.poll(async () => (await load()).status, { timeout: TASK_RUN_TIMEOUT_MS }).toBe('ready');
  return load();
}

test('冻结的审查范围、设计下钻、人工处置与离线导出在亮暗主题下可用', async ({ page, request, browser }, info) => {
  test.setTimeout(60_000);
  await patchSettings(request, { 'ui.theme': 'default', 'ui.mode': 'pro' });
  await page.setViewportSize({ width: 1600, height: 1050 });
  const project = await createProject(request, null);
  mkdirSync(join(project.repoPath, 'src'));
  const commitAll = (label: string) => {
    git(project.repoPath, 'add', '--all');
    git(project.repoPath, 'commit', '-m', label);
    return git(project.repoPath, 'rev-parse', 'HEAD');
  };
  writeFileSync(join(project.repoPath, feePath), source.replace('Math.round', 'Math.floor'));
  writeFileSync(join(project.repoPath, settlePath), 'export const settlement = "reviewed batch";\n');
  const base = commitAll('Add settlement fixture');
  writeFileSync(join(project.repoPath, feePath), source);
  writeFileSync(join(project.repoPath, 'ops-notes.txt'), 'check settlement totals\n');
  const reviewedSha = commitAll('Round half amounts');
  const design = await designFixture(request, project);
  const chapter = design.sections[0];
  const file = design.files.find(({ relPath }) => relPath === feePath);
  const diagram = design.diagrams[0];
  if (chapter === undefined || file === undefined || diagram === undefined) throw new Error('测试设计缺少影响节点');
  const staticSource = { evidenceClass: 'static', evidencePath: feePath, lineStart: 1, lineEnd: 1 };
  await queueCodeReviewerTurn(request, project, [
    {
      type: 'callTool',
      name: 'submit_findings',
      args: {
        summary: '余额尾差会影响日终清分。',
        findings: [
          {
            severity: 'major',
            category: 'correctness',
            title: findingTitle,
            path: feePath,
            line: 1,
            description: '舍入边界影响批量清分。',
            suggestion: '补充半数金额用例。',
            affectedImpactIds: ['fee-impact'],
          },
        ],
        impacts: [
          {
            id: 'fee-impact',
            targetKind: 'submodule',
            targetId: encodeGitImpactTargetId(chapter.id, 'fee'),
            title: moduleTitle,
            classification: 'direct',
            sourcePaths: [feePath],
            reason: '舍入从 floor 改为 round。',
            ...staticSource,
            suggestedChecks: [regression],
          },
          {
            id: 'settlement',
            targetKind: 'transaction',
            targetId: diagram.id,
            title: transactionTitle,
            classification: 'indirect',
            viaImpactIds: ['fee-impact'],
            reason: '批量清分使用该手续费。',
            ...staticSource,
            evidencePath: settlePath,
            suggestedChecks: [],
          },
          {
            id: 'refund',
            targetKind: 'file',
            title: '退款对账尾差',
            classification: 'possible',
            viaImpactIds: ['fee-impact'],
            evidenceClass: 'inferred',
            reason: '需要核对退款是否复用新费用。',
            suggestedChecks: [],
          },
          {
            id: 'chapter',
            targetKind: 'section',
            targetId: chapter.id,
            title: chapterTitle,
            classification: 'direct',
            reason: '已有设计明确了费用规则。',
            ...staticSource,
            suggestedChecks: [],
          },
          {
            id: 'file',
            targetKind: 'file',
            targetId: file.id,
            title: '计费源码',
            classification: 'direct',
            reason: '修改了取整函数。',
            ...staticSource,
            suggestedChecks: [],
          },
          {
            id: 'symbol',
            targetKind: 'symbol',
            targetId: encodeGitImpactTargetId(file.id, 'fee-round'),
            title: feeSymbol,
            classification: 'direct',
            reason: '手续费函数直接变化。',
            ...staticSource,
            suggestedChecks: [],
          },
        ],
        regression_checks: [regression, '验证退款仍读取原单费用'],
      },
    },
  ]);
  const review = gitReviewSchema.parse(
    await responseData(
      await request.post(`${API_BASE}/projects/${project.id}/git/reviews`, {
        headers: AUTH,
        data: { target: { kind: 'range', from: base, to: reviewedSha } },
      }),
    ),
  );
  const reviewUrl = `/git/${project.id}?view=review&review=${review.id}`;
  await page.goto(reviewUrl);
  await expect(page.getByText('精确匹配快照', { exact: true })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('git-review-verdict')).toContainText('余额尾差会影响日终清分。');
  // 审查结束后修改证据文件，跳转仍只能定位到已审查的提交。
  writeFileSync(join(project.repoPath, settlePath), 'export const settlement = "live HEAD only";\n');
  commitAll('Advance HEAD after review');

  await page.getByRole('tab', { name: /代码问题/ }).click();
  const status = page.getByRole('combobox', { name: `${findingTitle}的处置状态` });
  await status.selectOption('accepted');
  await expect(status).toHaveValue('accepted');
  await page.reload();
  await page.getByRole('tab', { name: /代码问题/ }).click();
  await expect(status).toHaveValue('accepted');
  await page.getByRole('button', { name: `${feePath}:1`, exact: true }).click();
  await expect(page.locator('[data-focus]')).toContainText('Math.round');
  await page.getByRole('button', { name: moduleTitle, exact: true }).click();
  await expect(page.getByRole('article', { name: moduleTitle, exact: true })).toBeFocused();

  const impactList = page.getByRole('tabpanel');
  await expect(impactList.getByText('静态确认').first()).toBeVisible();
  await expect(
    impactList.getByRole('article', { name: '退款对账尾差' }).getByText('AI 推断', { exact: true }),
  ).toBeVisible();
  await expect(impactList.getByText('影响传播简图')).toBeVisible();
  await expect(impactList.getByText(/当前设计未覆盖 1 个变更文件/)).toBeVisible();
  await impactList.getByText('查看传播关系', { exact: true }).click();
  await expect(
    impactList.getByRole('listitem').filter({ hasText: `${feePath} → ${moduleTitle}（静态确认）` }),
  ).toBeVisible();
  await expect(
    impactList.getByRole('listitem').filter({ hasText: `${moduleTitle} → ${transactionTitle}（静态确认）` }),
  ).toBeVisible();
  await expect(
    impactList.getByRole('listitem').filter({ hasText: `${moduleTitle} → 退款对账尾差（AI 推断）` }),
  ).toBeVisible();
  await impactList.getByText('查看传播关系', { exact: true }).click();
  await page.getByRole('button', { name: '导出离线 HTML' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/git-review-phase-2-dark.png', animations: 'disabled' });
  await patchSettings(request, { 'ui.theme': 'codex' });
  await page.reload();
  await page.getByRole('tab', { name: /代码问题/ }).click();
  await page.getByRole('button', { name: `${feePath}:1`, exact: true }).click();
  await page.getByRole('tab', { name: /业务影响/ }).click();
  await page.screenshot({ path: 'screenshots/git-review-phase-2-light.png', animations: 'disabled' });

  const indirect = page.getByRole('article', { name: transactionTitle, exact: true });
  await indirect.getByRole('button', { name: /源码证据/ }).click();
  const evidence = page.getByRole('dialog', { name: /审查源码证据/ });
  await expect(evidence).toContainText('该文件在本次审查范围内没有变更。');
  await expect(evidence.getByRole('region', { name: '新版源码' })).toContainText('reviewed batch');
  await evidence.getByRole('button', { name: '旧版源码' }).click();
  await expect(evidence.getByRole('region', { name: '旧版源码' })).toContainText('reviewed batch');
  await evidence.getByRole('button', { name: '关闭' }).click();

  await page
    .getByRole('article', { name: moduleTitle, exact: true })
    .getByRole('button', { name: /源码证据/ })
    .click();
  await expect(evidence.locator('[data-focus]')).toContainText('Math.round');
  await evidence.getByRole('button', { name: '旧版源码' }).click();
  await expect(evidence.getByRole('region', { name: '旧版源码' })).toContainText('Math.floor');
  await evidence.getByRole('button', { name: '关闭' }).click();

  for (const [title, heading] of [
    [moduleTitle, moduleTitle],
    [transactionTitle, transactionTitle],
    [chapterTitle, chapterTitle],
    ['计费源码', 'calc-fee.ts'],
    [feeSymbol, feeSymbol],
  ] as const) {
    await page.getByRole('article', { name: title, exact: true }).getByRole('link', { name: '跳到设计节点' }).click();
    await expect(page).toHaveURL(new RegExp(`/designs/${design.id}`));
    await expect(page.getByRole('main').getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await page.goBack();
    await page.getByRole('tab', { name: /业务影响/ }).click();
  }

  await page.getByRole('tab', { name: /回归建议/ }).click();
  await expect(page.getByRole('tabpanel').getByText(regression, { exact: true })).toBeVisible();
  const targetDir = mkdtempSync(join(tmpdir(), 'git-review-html-'));
  await page.getByRole('button', { name: '导出离线 HTML' }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出离线 HTML' });
  await exportDialog.getByRole('textbox', { name: '导出目录' }).fill(targetDir);
  await exportDialog.getByRole('button', { name: '导出', exact: true }).click();
  await expect(page.getByText(/已导出离线 HTML/)).toBeVisible();
  const exported = join(targetDir, 'index.html');
  expect(readFileSync(exported, 'utf8')).toContain(findingTitle);
  const offline = await browser.newContext({ offline: true });
  try {
    const report = await offline.newPage();
    await report.goto(pathToFileURL(exported).href);
    await expect(report.getByRole('heading', { name: findingTitle })).toBeVisible();
    await report.getByLabel('处置状态').selectOption('dismissed');
    await expect(report.getByRole('heading', { name: findingTitle })).toBeHidden();
    await report.getByLabel('处置状态').selectOption('accepted');
    await expect(report.getByRole('heading', { name: findingTitle })).toBeVisible();
    await report.getByLabel('主题').selectOption('dark');
    await expect(report.locator('html')).toHaveAttribute('data-theme', 'dark');
    await report.getByLabel('主题').selectOption('light');
    await report.screenshot({ path: 'screenshots/git-review-phase-2-offline.png', animations: 'disabled' });
  } finally {
    await offline.close();
  }

  await page.getByRole('button', { name: /据此修复/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('requirement')).toContain(findingTitle);
  await queueCodeReviewerTurn(request, project, [
    {
      type: 'callTool',
      name: 'submit_findings',
      args: { summary: '重新检查后的结论。', findings: [] },
    },
  ]);
  await page.goto(reviewUrl);
  await page.getByRole('button', { name: '重新审查' }).click();
  await expect(page.getByTestId('git-review-verdict')).toContainText('重新检查后的结论。');
  expect(new URL(page.url()).searchParams.get('review')).not.toBe(review.id);
  const history = page.getByRole('combobox', { name: 'AI 审查' });
  await history.selectOption(review.id);
  await page.getByRole('tab', { name: /代码问题/ }).click();
  await expect(status).toHaveValue('accepted');

  const deleted = await request.delete(`${API_BASE}/designs/${design.id}`, { headers: AUTH });
  expect(deleted.ok(), await deleted.text()).toBe(true);
  await page.goto(reviewUrl);
  await expect(page.getByText('关联项目设计已删除', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /业务影响/ }).click();
  await expect(
    page.getByRole('article', { name: moduleTitle, exact: true }).getByRole('button', { name: '跳到设计节点' }),
  ).toBeDisabled();

  await createPptFromSource(page, request, info, project, {
    kind: 'git_review',
    refId: review.id,
    title: review.label,
    theme: ThemeId.Codex,
    brief: /发版评审/,
  });
});

test('工作区证据变化后提示历史报告差异，仍可阅读旧版基线', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  const path = 'fee.ts';
  writeFileSync(join(project.repoPath, path), 'export const rate = 10;\n');
  git(project.repoPath, 'add', path);
  git(project.repoPath, 'commit', '-m', 'Record old fee rate');
  writeFileSync(join(project.repoPath, path), 'export const rate = 20;\n');
  await queueCodeReviewerTurn(request, project, [
    {
      type: 'callTool',
      name: 'submit_findings',
      args: {
        summary: '请核对工作区改动。',
        findings: [
          {
            title: '计费值已改动',
            path,
            line: 1,
            severity: 'major',
            category: 'correctness',
            description: '确认该费率适用所有商户。',
          },
        ],
      },
    },
  ]);
  await page.goto(`/git/${project.id}?view=changes&tab=review`);
  await page.getByRole('button', { name: '开始审查', exact: true }).click();
  await expect(page.getByTestId('git-review-verdict')).toContainText('请核对工作区改动。');
  await expect(page.getByText('未建立项目设计，仅基于源码审查', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '去新建项目设计' })).toHaveAttribute('href', new RegExp(project.id));

  await page.getByRole('tab', { name: /代码问题/ }).click();
  await page.getByRole('button', { name: `${path}:1`, exact: true }).click();
  const evidence = page.getByRole('dialog', { name: /审查源码证据/ });
  await expect(evidence.locator('[data-focus]')).toContainText('rate = 20');
  await evidence.getByRole('button', { name: '关闭' }).click();

  writeFileSync(join(project.repoPath, path), 'export const rate = 30;\n');
  await page.reload();
  await expect(page.getByText('工作区已变化，当前文件与审查开始时不同。')).toBeVisible();
  await page.getByRole('tab', { name: /代码问题/ }).click();
  await page.getByRole('button', { name: `${path}:1`, exact: true }).click();
  await expect(evidence).toContainText('工作区已变化，无法重现本次审查的源码证据。');
  await evidence.getByRole('button', { name: '旧版源码' }).click();
  await expect(evidence.getByRole('region', { name: '旧版源码' })).toContainText('rate = 10');
  const historicId = new URL(page.url()).searchParams.get('review');
  expect(historicId).not.toBeNull();
  git(project.repoPath, 'add', path);
  git(project.repoPath, 'commit', '-m', 'Move the worktree base');
  await page.goto(`/git/${project.id}?view=review&review=${historicId}`);
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('changes');
  await expect.poll(() => new URL(page.url()).searchParams.get('review')).toBe(historicId);
  await expect(page.getByTestId('git-review-verdict')).toContainText('请核对工作区改动。');
});

test('指定提交的历史审查链接选中原报告', async ({ request, page }) => {
  await patchSettings(request, { 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, 'fee.ts'), 'export const fee = 20;\n');
  git(project.repoPath, 'add', 'fee.ts');
  git(project.repoPath, 'commit', '-m', 'Add fee');
  const sha = git(project.repoPath, 'rev-parse', 'HEAD');
  const start = async (summary: string) => {
    await queueCodeReviewerTurn(request, project, [
      {
        type: 'callTool',
        name: 'submit_findings',
        args: { summary, findings: [] },
      },
    ]);
    const result = gitReviewSchema.parse(
      await responseData(
        await request.post(`${API_BASE}/projects/${project.id}/git/reviews`, {
          headers: AUTH,
          data: { target: { kind: 'commit', sha } },
        }),
      ),
    );
    await expect
      .poll(
        async () =>
          gitReviewSchema.parse(
            await responseData(await request.get(`${API_BASE}/git/reviews/${result.id}`, { headers: AUTH })),
          ).status,
      )
      .toBe('succeeded');
    return result.id;
  };
  const historicId = await start('较早的提交审查。');
  const latestId = await start('最新的提交审查。');
  await page.goto(`/git/${project.id}?view=review&review=${historicId}`);
  await expect(page.getByTestId('git-review-verdict')).toContainText('较早的提交审查。');
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('commits');
  const history = page.getByRole('combobox', { name: 'AI 审查' });
  await expect(history).toHaveValue(historicId);
  await history.selectOption(latestId);
  await expect(page.getByTestId('git-review-verdict')).toContainText('最新的提交审查。');
  await expect.poll(() => new URL(page.url()).searchParams.get('review')).toBe(latestId);
});
