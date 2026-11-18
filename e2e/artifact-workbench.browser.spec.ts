import { ARTIFACT_WORKFLOW_KEY, artifactTaskSchema, deckSchema, TaskStatus, taskDetailSchema } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type FakeStep, queueTurn, submitResult, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

const docx = (text: string): FakeStep => ({
  type: 'callTool',
  name: 'write_task_docx',
  args: {
    file: '复盘.docx',
    blocks: [
      { type: 'heading', level: 1, text: '核心结论' },
      { type: 'paragraph', text },
    ],
  },
});
const textFile = (file: string, text: string): FakeStep => ({
  type: 'callTool',
  name: 'write_task_text',
  args: { file, text },
});

const cases = [
  {
    format: 'Word',
    before: docx('新增 100 人。'),
    after: docx('新增 120 人，主要来自搜索。'),
    original: '新增 100 人。',
    revised: '新增 120 人，主要来自搜索。',
    location: '第 3 行',
  },
  {
    format: 'Excel',
    before: {
      type: 'callTool',
      name: 'write_task_xlsx',
      args: {
        file: '渠道.xlsx',
        sheets: [
          {
            name: '渠道汇总',
            columns: [{ header: '渠道' }, { header: '费用', type: 'number' }],
            rows: [
              ['搜索', 42],
              ['内容', 36],
            ],
          },
        ],
      },
    },
    after: {
      type: 'callTool',
      name: 'edit_task_xlsx',
      args: {
        file: '渠道.xlsx',
        source: { file: '渠道.xlsx' },
        operations: [{ op: 'set_cells', sheet: '渠道汇总', start: 'B2', values: [[44], [38]] }],
      },
    },
    original: '42',
    revised: '44',
    location: '渠道汇总!B2:B3',
  },
  {
    format: 'Markdown',
    before: textFile('复盘.md', '# 核心结论\n\n新增 100 人。'),
    after: textFile('复盘.md', '# 核心结论\n\n新增 120 人，主要来自搜索。'),
    original: '新增 100 人。',
    revised: '新增 120 人，主要来自搜索。',
    location: '第 3 行',
  },
  {
    format: 'TXT',
    before: textFile('复盘.txt', '核心结论\n新增 100 人。\n统计口径'),
    after: textFile('复盘.txt', '核心结论\n新增 120 人，主要来自搜索。\n统计口径'),
    original: '新增 100 人。',
    revised: '新增 120 人，主要来自搜索。',
    location: '第 2–3 行',
  },
] as const satisfies ReadonlyArray<{
  format: string;
  before: FakeStep;
  after: FakeStep;
  original: string;
  revised: string;
  location: string;
}>;

for (const item of cases) {
  test(`${item.format} 产物可预览、定位标注、比较版本并验收`, async ({ page, request }, testInfo) => {
    const project = await createProject(request, null);
    // Hold completion after the first file so the test can see the preview while the task is still running.
    await queueTurn(request, project, { title: '生成首版产物' }, [
      { type: 'think', text: '先生成可查看的初稿。' },
      ...(item.format === 'Word'
        ? [
            {
              type: 'tool' as const,
              tool: 'read',
              input: { filePath: project.repoPath + '/package.json' },
              output: '{"scripts":{"test":"vitest run"}}',
            },
            { type: 'permission' as const, permission: 'bash', patterns: ['node verify-source.mjs'] },
          ]
        : []),
      item.before,
      { type: 'permission', permission: 'bash', patterns: ['node check-artifact.mjs'] },
      submitResult('首版已就绪'),
    ]);
    await queueTurn(request, project, { title: '产物修改 1' }, [
      item.after,
      { type: 'permission', permission: 'bash', patterns: ['node check-revision.mjs'] },
      submitResult('已完成本轮修改'),
    ]);
    await page.goto(`/?projectId=${project.id}`);
    await page.getByRole('button', { name: '直接开始', exact: true }).click();
    const workflows = page.getByRole('group', { name: '选择流程开始任务' });
    await workflows.getByRole('button', { name: /^更多流程/ }).click();
    await workflows.getByRole('button', { name: /^文档与表格/ }).click();
    await page.getByLabel('需求').fill(`整理一份 ${item.format} 运营复盘`);
    await page.getByRole('button', { name: /^开始/ }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/, { timeout: TASK_RUN_TIMEOUT_MS });
    const workbench = page.getByTestId('artifact-workbench');
    if (item.format === 'Word') {
      await page.getByRole('button', { name: '跟随 AI 阅读' }).click();
      await expect(page.getByRole('region', { name: '项目文件阅读' })).toContainText('vitest run');
      await page.getByRole('button', { name: '返回成果' }).click();
      await workbench.getByRole('button', { name: '允许一次' }).click();
    }
    const taskPath = new URL(page.url()).pathname;
    const detail = async () =>
      taskDetailSchema.parse(await (await request.get(`${API_BASE}${taskPath}`, { headers: AUTH })).json());
    await expect(workbench.getByText(item.original, { exact: true })).toBeVisible({ timeout: 2 * TASK_RUN_TIMEOUT_MS });
    expect((await detail()).status).toBe(TaskStatus.Running);
    await workbench.getByRole('button', { name: '允许一次' }).click();
    await expect(page.getByText('待查看产物', { exact: true })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
    await workbench.getByRole('button', { name: '标注修改' }).click();
    if (item.format === 'Excel') {
      await workbench.getByRole('button', { name: 'B2 42' }).click();
      await workbench.getByRole('button', { name: 'B3 36' }).click({ modifiers: ['Shift'] });
    } else if (item.format === 'TXT') {
      await workbench.getByRole('button', { name: '标注第 2 行' }).click();
      await workbench.getByRole('button', { name: '标注第 3 行' }).click({ modifiers: ['Shift'] });
    } else {
      await workbench.getByRole('button', { name: '标注第 3 行' }).click();
    }
    await expect(
      workbench.getByRole('complementary', { name: '标注修改' }).getByText(item.location, { exact: false }),
    ).toBeVisible();
    await workbench.getByLabel('怎么修改').fill('按新数据更新这里，保留其他内容。');
    await workbench.getByRole('button', { name: '加入本轮' }).click();
    await workbench.getByRole('button', { name: '交给 AI 修改' }).click();
    const releaseRevision = workbench.getByTestId('inbox-permission').filter({ hasText: 'node check-revision.mjs' });
    await expect(releaseRevision).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
    await expect(workbench.getByText(item.original, { exact: true })).toBeVisible();
    await expect(workbench.getByText(item.revised, { exact: true })).toHaveCount(0);
    expect(artifactTaskSchema.parse((await detail()).artifact).versions.map(({ number }) => number)).toEqual([1]);
    await releaseRevision.getByRole('button', { name: '允许一次' }).click();
    await expect(workbench.getByText(item.revised, { exact: true })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
    await expect(page.getByText('待查看产物', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '文档预览' })).toHaveAttribute('aria-selected', 'true');
    await expect(workbench.locator('[data-kind="修改"]').first()).toBeVisible();
    await page.getByRole('button', { name: '扩大视图' }).click();
    await page.screenshot({ path: testInfo.outputPath('document.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '还原视图' }).click();
    const reviewed = await detail();
    const artifact = artifactTaskSchema.parse(reviewed.artifact);
    expect(artifact.versions.map(({ number }) => number)).toEqual([1, 2]);
    const stale = await request.post(`${API_BASE}${taskPath}/revise-artifact`, {
      headers: AUTH,
      data: {
        versionId: artifact.versions[0]?.id,
        notes: [{ anchor: { kind: 'whole' }, quote: '', note: '旧版本意见' }],
      },
    });
    expect(stale.status()).toBe(409);
    const revision = reviewed.plan?.graph.nodes.find(({ title }) => title === '产物修改 1');
    expect(revision?.instructions).toContain('aw-artifact-revision');
    expect(revision?.instructions).toContain('按新数据更新这里，保留其他内容。');
    expect(artifact.rounds).toMatchObject([
      { versionId: artifact.versions[0]?.id, notes: [{ note: '按新数据更新这里，保留其他内容。' }] },
    ]);

    const waiting = await request.get(`${API_BASE}/tasks?projectId=${project.id}&displayGroup=artifact_review`, {
      headers: AUTH,
    });
    await expect(waiting).toBeOK();
    expect((await waiting.json()).items).toMatchObject([{ id: reviewed.id, workflow: { key: ARTIFACT_WORKFLOW_KEY } }]);
    await workbench.getByRole('button', { name: '版本记录' }).click();
    await workbench.getByRole('button', { name: '对照上一版' }).click();
    await expect(
      workbench.getByRole('region', { name: '改前 v1' }).getByText(item.original, { exact: true }),
    ).toBeVisible();
    await expect(
      workbench.getByRole('region', { name: '产物预览 v2' }).getByText(item.revised, { exact: true }),
    ).toBeVisible();
    await workbench.getByRole('button', { name: '验收产物' }).click();
    await expect.poll(async () => (await detail()).status).toBe(TaskStatus.Completed);

    const file = artifact.versions[1];
    if (file === undefined) throw new Error('Expected the revised artifact');
    const response = await request.get(`${API_BASE}${taskPath}/artifacts/${file.id}/raw`, { headers: AUTH });
    await expect(response).toBeOK();
    const bytes = await response.body();
    if (item.format === 'Excel' || item.format === 'Word') expect(bytes.subarray(0, 2).toString()).toBe('PK');
    else expect(bytes.toString()).toContain(item.revised);
    expect(new URL(page.url()).pathname).toBe(taskPath);

    if (item.format === 'Word' || item.format === 'Excel') {
      const earlier = artifact.versions[0];
      if (earlier === undefined) throw new Error('Expected the first artifact version');
      await queueTurn(request, project, { agent: 'aw-slides' }, [
        {
          type: 'callTool',
          name: 'submit_outline',
          args: {
            title: '基于首版的汇报',
            understanding: { audience: '运营团队', duration: '5 分钟', assumptions: [] },
            slides: [{ layout: 'cover', title: '运营复盘', points: [] }],
          },
        },
      ]);
      await workbench.getByRole('combobox', { name: '产物版本' }).selectOption(earlier.id);
      await workbench.getByRole('link', { name: '做成 PPT' }).click();
      const source = `${reviewed.key} · ${earlier.name} · v1`;
      await expect(page.getByRole('list', { name: '资料' })).toContainText(source);
      await page.getByRole('textbox', { name: '这份 PPT 讲什么' }).fill('根据首版制作汇报');
      await page.getByRole('button', { name: /^生成大纲/ }).click();
      await expect(page).toHaveURL(/\/ppt\/[0-9a-f-]+$/);
      const deckPath = new URL(page.url()).pathname.replace('/ppt/', '/decks/');
      const deck = deckSchema.parse(await (await request.get(`${API_BASE}${deckPath}`, { headers: AUTH })).json());
      expect(deck.materials).toMatchObject([
        { kind: 'artifact', title: source, refId: reviewed.id, artifactVersionId: earlier.id },
      ]);
      await page.getByRole('region', { name: '来源产物' }).getByRole('link', { name: source }).click();
      await expect(page).toHaveURL(new RegExp(`${taskPath}\\?artifactVersion=${earlier.id}`));
      await expect(workbench.getByRole('combobox', { name: '产物版本' })).toHaveValue(earlier.id);
      await expect(workbench.getByText(item.original, { exact: true })).toBeVisible();
      await expect(workbench.getByText(item.revised, { exact: true })).toHaveCount(0);
    }
  });
}
