import type { InitiativeDetailDTO } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings, queueBreakdownTurn, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

test('被移除且同 key 重建的未启动工作包仍显示原验收快照', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  const breakdown = (key: string, acceptance: string) => ({
    title: '需求',
    summary: '分解需求',
    understanding: { scope: '原始需求' },
    phases: [{ title: '阶段', goal: '完成需求' }],
    items: [
      {
        key,
        title: `${key} 工作包`,
        phase: 1,
        workflow: 'unit_tests',
        requirement: acceptance,
        acceptance: [{ key: 'check', title: acceptance, expected: '原始预期' }],
      },
    ],
    coverage: [{ point: '原始需求', items: [key], links: [{ item: key, acceptance: ['check'] }] }],
  });
  const queue = async (key: string, acceptance: string) =>
    queueBreakdownTurn(request, project, [
      { type: 'callTool', name: 'submit_breakdown', args: breakdown(key, acceptance) },
    ]);
  await queue('a', '原验收项');
  const response = await request.post(`${API_BASE}/initiatives`, {
    headers: AUTH,
    data: { projectId: project.id, requirement: '原始需求' },
  });
  await expect(response).toBeOK();
  const created: InitiativeDetailDTO = await response.json();
  const waitForRevision = async (revision: number) => {
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API_BASE}/initiatives/${created.id}`, { headers: AUTH });
          const body: InitiativeDetailDTO = await res.json();
          return [body.status, body.latestRun?.seq];
        },
        { timeout: TASK_RUN_TIMEOUT_MS },
      )
      .toEqual(['draft_ready', revision]);
  };
  await waitForRevision(1);
  for (const [revision, key, label] of [
    [2, 'b', '替代验收项'],
    [3, 'a', '新验收项'],
  ] as const) {
    await queue(key, label);
    const res = await request.post(`${API_BASE}/initiatives/${created.id}/rebreakdown`, { headers: AUTH, data: {} });
    await expect(res).toBeOK();
    await waitForRevision(revision);
  }
  await page.goto(`/initiatives/${created.id}`);
  const coverage = page.getByTestId('initiative-understanding');
  await coverage.getByText('需求 1 点，1 点有对应工作包').click();
  await coverage.getByText('查看之前的覆盖版本').click();
  await coverage.getByText('拆解版本 1', { exact: true }).click();
  const version = coverage
    .locator('details')
    .filter({ has: page.locator('summary').getByText('拆解版本 1', { exact: true }) })
    .last();
  await version.getByText('原始需求', { exact: true }).click();
  await expect(version.getByText('对应的工作包已删除: a 工作包')).toBeVisible();
  await expect(version.getByText('原验收项', { exact: true })).toBeVisible();
  await expect(version.getByText('预期：原始预期', { exact: true })).toBeVisible();
  await expect(version.getByText('当时尚未开始任务，未核验', { exact: true })).toBeVisible();
  await expect(version.getByText('新验收项', { exact: true })).toHaveCount(0);
});
