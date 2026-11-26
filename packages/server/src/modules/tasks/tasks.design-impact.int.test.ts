import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDesignOp,
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DesignSectionKind,
  DesignStatus,
  GitImpactClassification,
  GitImpactTargetKind,
  generateDesignOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  ServerEventType,
  taskDesignImpactOp,
  taskDiffOp,
  updateDesignOutlineOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, taskInReview } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const oldPath = 'src/fees.ts';
const newPath = 'src/fees-next.ts';

async function readyDesign(projectId: string) {
  const { body: draft } = await t.call(createDesignOp, { projectId, aiReviewEnabled: false });
  const { body: outline } = await t.call(updateDesignOutlineOp, {
    id: draft.id,
    sections: [{ kind: DesignSectionKind.Module, title: '费用模块', scopePaths: [oldPath] }],
  });
  const [section] = outline.sections;
  if (!section) throw new Error('Expected a design section');
  const evidence = [{ evidenceClass: DesignEvidenceClass.Static, relPath: oldPath, lineStart: 1, lineEnd: 1 }];
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, {
      sectionId: section.id,
      summary: '计算支付费率',
      files: [{ relPath: oldPath, responsibility: '提供费率', symbols: [] }],
      blocks: [
        {
          type: 'submodule',
          id: 'rates',
          title: '费率引擎',
          summary: '提供支付费率',
          files: [oldPath],
          behaviors: [{ title: '读取费率', markdown: '使用费率常量', evidence }],
        },
        { type: 'transaction', title: '退款', diagramId: 'refund', evidence },
      ],
      diagrams: [
        {
          id: 'refund',
          title: '退款调用',
          kind: DesignDiagramKind.BusinessFlow,
          nodes: [{ id: 'entry', label: '退款入口', relPath: oldPath }],
          edges: [],
        },
      ],
    }),
    { agent: OPENCODE_AGENT_NAME.designer },
  );
  const finished = waitForEvent(
    t.app.events,
    ServerEventType.DesignUpdated,
    ({ designId }) => designId === draft.id && t.app.services.designs.get(draft.id).status === DesignStatus.Ready,
  );
  expect((await t.call(generateDesignOp, { id: draft.id })).status).toBe(200);
  await finished;
  await t.fake.settled();
  return t.app.services.designs.get(draft.id);
}

it('项目仅有设计草稿时返回空结果，即使任务没有可读取的工作树', async () => {
  const { project } = await addProject(t, { files: { [oldPath]: 'export const rate = 1;\n' } });
  expect((await t.call(createDesignOp, { projectId: project.id })).status).toBe(201);
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
  expect((await t.call(taskDiffOp, { id: task.id })).status).toBe(404);
  const impact = await t.call(taskDesignImpactOp, { id: task.id });
  expect(impact.status).toBe(200);
  expect(impact.body).toBeNull();
  expect(t.fake.sessions).toHaveLength(0);
});

it.each([DesignKnowledgeMatch.Exact, DesignKnowledgeMatch.Reference])(
  '按任务 Diff 基线标记 %s 并使用重命名前的路径检出模块与交易',
  async (match) => {
    const { project, repo } = await addProject(t, { files: { [oldPath]: 'export const rate = 1;\n' } });
    const design = await readyDesign(project.id);
    const snapshotSha = await repo.git('rev-parse', 'HEAD');
    if (match === DesignKnowledgeMatch.Reference) {
      await writeFile(join(repo.path, 'README.md'), '# 新基线\n');
      await repo.git('commit', '-am', 'Advance task baseline');
    }

    const task = await taskInReview(t, project.id, { 'NOTE.md': '本任务调整费率文件\n' });
    if (task.git.worktreePath === null) throw new Error('Expected a ready task worktree');
    await runGit(['mv', '--', oldPath, newPath], { cwd: task.git.worktreePath });
    const { body: diff } = await t.call(taskDiffOp, { id: task.id });
    expect(diff.files).toContainEqual(expect.objectContaining({ path: newPath, oldPath, status: 'renamed' }));

    const sessionCount = t.fake.sessions.length;
    const impact = await t.call(taskDesignImpactOp, { id: task.id });
    expect(impact.status).toBe(200);
    expect(taskDesignImpactOp.output.parse(impact.body)).toMatchObject({
      designId: design.id,
      snapshotSha,
      dirty: false,
      coverage: { doneSections: 1, totalSections: 1 },
      match,
      moduleCount: 2,
      transactionCount: 1,
      truncated: false,
    });
    expect(impact.body?.candidates).toEqual(
      expect.arrayContaining([
        {
          targetKind: GitImpactTargetKind.Section,
          targetId: design.sections[0]?.id,
          title: '费用模块',
          classification: GitImpactClassification.Direct,
          distance: 0,
          sourcePath: oldPath,
        },
        expect.objectContaining({ targetKind: GitImpactTargetKind.Submodule, title: '费率引擎', sourcePath: oldPath }),
        expect.objectContaining({ targetKind: GitImpactTargetKind.Transaction, title: '退款', sourcePath: oldPath }),
      ]),
    );
    expect(impact.body?.uncoveredPaths.toSorted()).toEqual(['NOTE.md', newPath].toSorted());
    expect(t.fake.sessions).toHaveLength(sessionCount);
    expect(t.app.services.designs.get(design.id)).toEqual(design);
  },
);
