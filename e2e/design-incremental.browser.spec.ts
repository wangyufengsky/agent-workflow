import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignSectionKind, DesignStatus, getDesignOp, McpToolName, OPENCODE_AGENT_NAME, ThemeId } from '@aw/shared';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type FakeStep, GIT_HEAVY_SPECS_SLOW, git, patchSettings } from './helpers.ts';

const PROJECT = '交易服务';
const FEES = '清分计费';
const SETTLEMENT = '商户结算';
const CALCULATE = 'src/fees/calculate.ts';
const ROUNDING = 'src/fees/rounding.ts';
const ARCHIVE = 'src/settlement/archive.ts';
const BATCH = 'src/settlement/batch.ts';
const INSTRUCTION = '说明新规则及其对账影响。';
const START_UPDATE = '按变更增量更新';

async function readDesign(request: APIRequestContext, id: string) {
  const response = await request.get(`${API_BASE}/designs/${id}`, { headers: AUTH });
  expect(response.ok(), await response.text()).toBe(true);
  return getDesignOp.output.parse(await response.json());
}

async function queueTurn(request: APIRequestContext, steps: FakeStep[]) {
  const response = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: { match: { title: `${PROJECT} 项目设计`, agent: OPENCODE_AGENT_NAME.designer }, steps },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

function section(sectionId: string, text: string, paths: string[]): FakeStep {
  return {
    type: 'callTool',
    name: McpToolName.SubmitDesignSection,
    args: {
      sectionId,
      summary: text,
      blocks: [{ type: 'markdown', markdown: text }],
      files: paths.map((relPath) => ({ relPath, responsibility: text, symbols: [] })),
      diagrams: [],
    },
  };
}

async function designFixture(request: APIRequestContext) {
  const project = await createProject(request, null);
  const renamed = await request.patch(`${API_BASE}/projects/${project.id}`, {
    headers: AUTH,
    data: { name: PROJECT },
  });
  expect(renamed.ok(), await renamed.text()).toBe(true);
  mkdirSync(join(project.repoPath, 'src/fees'), { recursive: true });
  mkdirSync(join(project.repoPath, 'src/settlement'), { recursive: true });
  writeFileSync(join(project.repoPath, CALCULATE), 'export const fee = 1;\n');
  writeFileSync(join(project.repoPath, ARCHIVE), 'export const archive = true;\n');
  writeFileSync(join(project.repoPath, BATCH), 'export const batchSize = 50;\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-m', 'Add fee and settlement sources');
  const base = git(project.repoPath, 'rev-parse', 'HEAD');
  const created = await request.post(`${API_BASE}/designs`, {
    headers: AUTH,
    data: { projectId: project.id, aiReviewEnabled: false },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = getDesignOp.output.parse(await created.json());
  const outline = await request.put(`${API_BASE}/designs/${id}/outline`, {
    headers: AUTH,
    data: {
      sections: [
        { kind: DesignSectionKind.Module, title: FEES, scopePaths: ['src/fees'], selected: true },
        { kind: DesignSectionKind.Module, title: SETTLEMENT, scopePaths: ['src/settlement'], selected: true },
      ],
    },
  });
  expect(outline.ok(), await outline.text()).toBe(true);
  const [fees, settlement] = getDesignOp.output.parse(await outline.json()).sections;
  if (fees === undefined || settlement === undefined) throw new Error('Expected two sections');
  await queueTurn(request, [section(fees.id, '每笔交易收取固定手续费。', [CALCULATE])]);
  await queueTurn(request, [section(settlement.id, '每批结算五十笔交易。', [ARCHIVE, BATCH])]);
  const generation = await request.post(`${API_BASE}/designs/${id}/generate`, { headers: AUTH, data: {} });
  expect(generation.ok(), await generation.text()).toBe(true);
  await expect.poll(async () => (await readDesign(request, id)).status).toBe(DesignStatus.Ready);

  writeFileSync(join(project.repoPath, CALCULATE), 'export const fee = 2;\n');
  writeFileSync(join(project.repoPath, ROUNDING), 'export const rounding = Math.round;\n');
  unlinkSync(join(project.repoPath, ARCHIVE));
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-m', 'Adjust the fee and remove legacy archiving');
  const head = git(project.repoPath, 'rev-parse', 'HEAD');
  return { id, fees, settlement, base, head };
}

test('增量更新可检查变更、局部提交、停止、重试并恢复上一版', async ({ page, request }, info) => {
  test.slow(GIT_HEAVY_SPECS_SLOW);
  const { id, fees, settlement, base, head } = await designFixture(request);
  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': ThemeId.Default });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/designs/${id}`);
  await page.getByRole('button', { name: '定位首个受影响章节' }).click();
  const reader = page.getByRole('region', { name: '设计正文' });
  await expect(reader.getByRole('heading', { name: FEES, exact: true })).toBeVisible();
  const update = page.getByRole('button', { name: START_UPDATE, exact: true });
  await update.click();
  const drawer = page.getByRole('dialog', { name: START_UPDATE });
  const feeCheckbox = drawer.getByRole('checkbox', { name: FEES, exact: true });
  const settlementCheckbox = drawer.getByRole('checkbox', { name: SETTLEMENT, exact: true });
  const strategy = drawer.getByRole('status');
  await expect(feeCheckbox).toBeChecked();
  await expect(settlementCheckbox).toBeChecked();
  await expect(strategy).toContainText('全部受影响章节更新后推进');
  await expect(drawer).toContainText(head.slice(0, 8));
  for (const [file, kind] of [
    [CALCULATE, '修改'],
    [ROUNDING, '新增'],
    [ARCHIVE, '删除'],
  ]) {
    await expect(drawer.getByRole('listitem').filter({ hasText: file })).toContainText(kind);
  }

  const screenshots = process.env.AW_DESIGN_INCREMENTAL_SCREENSHOTS ?? info.outputPath('screenshots');
  mkdirSync(screenshots, { recursive: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', ThemeId.Default);
  await page.screenshot({ path: join(screenshots, 'incremental-dark.png'), animations: 'disabled' });
  await settlementCheckbox.uncheck();
  await expect(strategy).toContainText('保留当前基线');
  await feeCheckbox.uncheck();
  await expect(drawer.getByRole('button', { name: '开始增量更新（0 章）' })).toBeDisabled();
  await expect(strategy).toContainText('请选择要更新的章节');
  await feeCheckbox.check();
  await drawer.getByRole('textbox', { name: '补充要求（可选）' }).fill(INSTRUCTION);
  await patchSettings(request, { 'ui.theme': ThemeId.Codex });
  await expect(page.locator('html')).toHaveAttribute('data-theme', ThemeId.Codex);
  await page.screenshot({ path: join(screenshots, 'incremental-light.png'), animations: 'disabled' });

  await queueTurn(request, [section(fees.id, '使用新的手续费及取整规则。', [CALCULATE, ROUNDING])]);
  await drawer.getByRole('button', { name: '开始增量更新（1 章）' }).click();
  await expect(drawer).toBeHidden();
  await expect(reader.getByText('使用新的手续费及取整规则。').first()).toBeVisible();
  await expect(update).toBeVisible();
  expect(await readDesign(request, id)).toMatchObject({ sourceSnapshot: { commitSha: base } });

  await update.click();
  await expect(settlementCheckbox).toBeChecked();
  await expect(feeCheckbox).toHaveCount(0);
  const streamed = '正在检查被移除的旧归档代码。';
  await queueTurn(request, [{ type: 'text', text: streamed }, { type: 'hang' }]);
  await drawer.getByRole('textbox', { name: '补充要求（可选）' }).fill(INSTRUCTION);
  await drawer.getByRole('button', { name: '开始增量更新（1 章）' }).click();
  const activity = page.getByRole('complementary', { name: 'AI 执行过程' });
  await expect(activity.getByText(streamed)).toBeVisible();
  await expect(update).toHaveCount(0);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  const retry = activity.getByRole('button', { name: '重试增量更新', exact: true });
  await expect(retry).toBeVisible();
  await page.reload();
  await retry.click();
  await expect(settlementCheckbox).toBeChecked();
  await expect(drawer.getByRole('textbox', { name: '补充要求（可选）' })).toHaveValue(INSTRUCTION);
  await expect(strategy).toContainText('全部受影响章节更新后推进');
  await queueTurn(request, [section(settlement.id, '使用批量结算，不再执行旧归档。', [BATCH])]);
  await drawer.getByRole('button', { name: '开始增量更新（1 章）' }).click();
  await expect.poll(async () => (await readDesign(request, id)).sourceSnapshot.commitSha).toBe(head);
  await expect(update).toHaveCount(0);
  const outline = page.getByRole('navigation', { name: '章节目录' });
  await outline.getByRole('button', { name: FEES, exact: false }).click();
  await reader.getByRole('button', { name: '恢复上一版', exact: true }).click();
  const restore = page.getByRole('dialog', { name: '恢复上一版' });
  await restore.getByRole('button', { name: '恢复上一版', exact: true }).click();
  await expect(reader.getByText('每笔交易收取固定手续费。').first()).toBeVisible();
  await expect(update).toBeVisible();
});

test.afterAll(({ request }) => patchSettings(request, { 'ui.theme': ThemeId.Codex, 'ui.mode': 'simple' }));
