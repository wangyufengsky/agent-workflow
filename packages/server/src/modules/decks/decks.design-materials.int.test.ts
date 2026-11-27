import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AttemptStatus,
  createDeckOp,
  createDesignOp,
  DECK_MATERIALS_MAX_CHARS,
  DeckMaterialKind,
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DesignSectionKind,
  deleteDesignOp,
  ErrorCode,
  FindingCategory,
  FindingSeverity,
  GitComparisonStatus,
  GitImpactClassification,
  GitImpactTargetKind,
  GitReviewTarget,
  generateDesignOp,
  getGitReviewOp,
  listDecksOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  ServerEventType,
  startGitReviewOp,
  stopGitReviewOp,
  updateDesignOp,
  updateDesignOutlineOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { createDecksRepo } from './decks.repo.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const path = 'src/fees.ts';
const reviewAgent = { agent: 'aw-code-reviewer' };
const evidence = [{ evidenceClass: DesignEvidenceClass.Inferred, rationale: '按费率入口归纳' }];
const designMaterial = (refId: string) => ({ kind: DeckMaterialKind.Design, refId });
const reviewMaterial = (refId: string) => ({ kind: DeckMaterialKind.GitReview, refId });
const materialError = { error: { code: ErrorCode.ValidationFailed } };

function materials(deckId: string) {
  const database = openDatabase(join(t.dataDir, DATABASE_FILE), join(import.meta.dirname, '../../../migrations'));
  try {
    return createDecksRepo(database.db).listMaterials(deckId);
  } finally {
    database.close();
  }
}

async function designWithContent(projectId: string, responsibility = '计算订单费率并舍入') {
  const {
    body: { id },
  } = await t.call(createDesignOp, { projectId, aiReviewEnabled: false });
  const { body: outline } = await t.call(updateDesignOutlineOp, {
    id,
    sections: [{ kind: DesignSectionKind.Module, title: '费用章节', scopePaths: [path] }],
  });
  const [section] = outline.sections;
  if (!section) throw new Error('Expected one designated section');
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, {
      sectionId: section.id,
      summary: '订单计费摘要',
      files: [{ relPath: path, responsibility: '计算费率', symbols: [] }],
      blocks: [
        {
          type: 'submodule',
          id: 'fee',
          title: '费率引擎',
          summary: responsibility,
          files: [path],
          behaviors: [{ title: '舍入', markdown: '核对小数位', evidence }],
        },
        { type: 'transaction', title: '支付退款', code: 'REFUND', channel: 'web', diagramId: 'flow', evidence },
      ],
      diagrams: [
        {
          id: 'flow',
          title: '退款调用',
          kind: DesignDiagramKind.BusinessFlow,
          nodes: [
            { id: 'refund', label: '退款入口' },
            { id: 'rate', label: '费率计算' },
          ],
          edges: [{ id: 'invocation', from: 'refund', to: 'rate', kind: 'call', ...evidence[0] }],
        },
      ],
    }),
    { agent: OPENCODE_AGENT_NAME.designer },
  );
  const finished = waitForEvent(
    t.app.events,
    ServerEventType.DesignUpdated,
    ({ designId }) => designId === id && t.app.services.designs.get(id).doneSections === 1,
  );
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  await finished;
  return t.app.services.designs.get(id);
}

it('创建 PPT 时冻结设计标题、基线、章节、子模块、交易和关系，设计更新或删除后仍保留', async () => {
  const { project, repo } = await addProject(t, { files: { [path]: 'export const rate = 1;\n' } });
  const design = await designWithContent(project.id);
  const created = await t.call(createDeckOp, { brief: '架构汇报', materials: [designMaterial(design.id)] });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.project).toMatchObject({ id: project.id });
  expect(created.body.materials).toMatchObject([{ ...designMaterial(design.id), title: design.title }]);
  const saved = materials(created.body.id);
  const [snapshot] = saved;
  if (!snapshot) throw new Error('Expected frozen design material');
  for (const text of [
    design.title,
    await repo.git('rev-parse', 'HEAD'),
    '## 费用章节',
    '订单计费摘要',
    'Submodule: 费率引擎 — 计算订单费率并舍入',
    'Transaction: 支付退款 (REFUND · web)',
    '退款入口 → 费率计算 · call',
  ]) {
    expect(snapshot.content).toContain(text);
  }
  const outlinePrompt = t.fake.prompts.find(({ text }) => text.includes('<material index="1" kind="design"'));
  expect(outlinePrompt?.text).toContain(snapshot.content);
  expect((await t.call(updateDesignOp, { id: design.id, title: '费用方案新版' })).status).toBe(200);
  expect(materials(created.body.id)).toEqual(saved);
  expect((await t.call(deleteDesignOp, { id: design.id })).status).toBe(204);
  expect(materials(created.body.id)).toEqual(saved);
});

it('将超长设计素材截断到 PPT 字符预算内并标明截断', async () => {
  const { project } = await addProject(t, { files: { [path]: 'export const rate = 1;\n' } });
  const design = await designWithContent(project.id, '费率详情'.repeat(DECK_MATERIALS_MAX_CHARS / 4));
  const created = await t.call(createDeckOp, { brief: '费用细节', materials: [designMaterial(design.id)] });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const [snapshot] = materials(created.body.id);
  expect(snapshot?.content.length).toBe(DECK_MATERIALS_MAX_CHARS);
  expect(snapshot?.content.endsWith('[Material truncated]')).toBe(true);
});

it('拒绝未完成的源和跨项目资料，不写入 PPT', async () => {
  const { project, repo } = await addProject(t, { files: { [path]: 'export const rate = 1;\n' } });
  const { project: other } = await addProject(t);
  const { body: draft } = await t.call(createDesignOp, { projectId: project.id });
  const pending = await t.call(createDeckOp, { brief: '未完成设计', materials: [designMaterial(draft.id)] });
  expect(pending.status).toBe(400);
  expect(pending.body).toMatchObject(materialError);

  await writeFile(join(repo.path, path), 'export const rate = 2;\n');
  t.fake.enqueue(script().hang(), reviewAgent);
  const started = await t.call(startGitReviewOp, { id: project.id, target: { kind: GitReviewTarget.Worktree } });
  expect(started.status).toBe(201);
  const reviewing = await t.call(createDeckOp, { brief: '未完成审查', materials: [reviewMaterial(started.body.id)] });
  expect(reviewing.status).toBe(400);
  expect(reviewing.body).toMatchObject(materialError);
  expect((await t.call(stopGitReviewOp, { reviewId: started.body.id })).status).toBe(200);

  const complete = await designWithContent(project.id);
  const crossProject = await t.call(createDeckOp, {
    brief: '跨项目设计',
    projectId: other.id,
    materials: [designMaterial(complete.id)],
  });
  expect(crossProject.status).toBe(400);
  expect(crossProject.body).toMatchObject(materialError);
  expect((await t.call(listDecksOp, {})).body.items).toEqual([]);
});

it.each([GitReviewTarget.Range, GitReviewTarget.Compare])(
  '冻结 %s 报告的端点、结论、代码问题、影响和回归建议',
  async (kind) => {
    const { project, repo } = await addProject(t, { files: { [path]: 'export const rate = 1;\n' } });
    const from = await repo.git('rev-parse', 'HEAD');
    await writeFile(join(repo.path, path), 'export const rate = 2;\n');
    await repo.git('commit', '-am', 'Change refund rate');
    const to = await repo.git('rev-parse', 'HEAD');
    const changed = { status: GitComparisonStatus.Modified, fromPath: path, toPath: path };
    t.fake.enqueue(
      script().callTool(McpToolName.SubmitFindings, {
        summary: '新费率缺少边界验证',
        findings: [
          {
            severity: FindingSeverity.Major,
            category: FindingCategory.Correctness,
            path,
            line: 1,
            title: '缺少小额边界',
            description: '退款金额可能偏高',
          },
        ],
        impacts: [
          {
            id: 'refund',
            targetKind: GitImpactTargetKind.Transaction,
            title: '退款交易',
            classification: GitImpactClassification.Indirect,
            evidenceClass: DesignEvidenceClass.Inferred,
            reason: '退款沿用订单费率',
            suggestedChecks: ['回归小额退款', '回归上限退款'],
          },
        ],
        regression_checks: ['回归小额退款'],
        ...(kind === GitReviewTarget.Compare
          ? {
              comparison: {
                fromMatch: DesignKnowledgeMatch.Missing,
                toMatch: DesignKnowledgeMatch.Missing,
                summary: '两端退款策略变化',
                sections: [{ ...changed, title: '费率模块架构' }],
                transactions: [{ ...changed, title: '退款交易流程' }],
              },
            }
          : {}),
      }),
      reviewAgent,
    );
    const started = await t.call(startGitReviewOp, { id: project.id, target: { kind, from, to } });
    expect(started.status).toBe(201);
    await t.fake.settled();
    const review = (await t.call(getGitReviewOp, { reviewId: started.body.id })).body;
    expect(review.status).toBe(AttemptStatus.Succeeded);
    const created = await t.call(createDeckOp, { brief: '发版评审', materials: [reviewMaterial(review.id)] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.project).toMatchObject({ id: project.id });
    expect(created.body.materials).toMatchObject([{ ...reviewMaterial(review.id), title: review.label }]);
    const [snapshot] = materials(created.body.id);
    if (!snapshot) throw new Error('Expected frozen Git report material');
    for (const text of [
      `Target: ${kind} · ${from} → ${to}`,
      '新费率缺少边界验证',
      '缺少小额边界',
      'Business impact · indirect',
      '退款沿用订单费率',
      '回归上限退款',
    ])
      expect(snapshot.content).toContain(text);
    expect(snapshot.content.match(/回归小额退款/g)).toHaveLength(1);
    if (kind === GitReviewTarget.Compare) {
      expect(snapshot.content).toContain('两端退款策略变化');
      expect(snapshot.content).toContain('### Architecture changes\n- [modified] 费率模块架构');
      expect(snapshot.content).toContain('### Transaction changes\n- [modified] 退款交易流程');
    }
  },
);
