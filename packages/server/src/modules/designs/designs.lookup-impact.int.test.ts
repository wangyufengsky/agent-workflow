import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDesignOp,
  DESIGN_IMPACT_LOOKUP_MAX_PATHS,
  DesignSectionKind,
  ErrorCode,
  GitImpactClassification,
  GitImpactTargetKind,
  generateDesignOp,
  lookupDesignImpactOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  ServerEventType,
  updateDesignOutlineOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

it('从保存的设计返回静态候选、基线与缺口，源文件删除后依旧可查', async () => {
  const relPath = 'src/entry.ts';
  const { project, repo } = await addProject(t, { files: { [relPath]: 'export const entry = 1;\n' } });
  const { body: design } = await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled: false });
  const { id } = design;
  const { body: outline } = await t.call(updateDesignOutlineOp, {
    id,
    sections: [{ kind: DesignSectionKind.Module, title: '入口模块', scopePaths: [relPath] }],
  });
  const [section] = outline.sections;
  if (section === undefined) throw new Error('Expected an outline section');
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, {
      sectionId: section.id,
      summary: '入口模块',
      blocks: [{ type: 'markdown', markdown: '项目入口' }],
      files: [{ relPath, responsibility: '导出入口', symbols: [] }],
      diagrams: [],
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

  const snapshot = t.app.services.designs.get(id);
  const file = snapshot.files.find((item) => item.relPath === relPath);
  if (file === undefined) throw new Error('Expected an indexed file');
  const sha = await repo.git('rev-parse', 'HEAD');
  const sessionCount = t.fake.sessions.length;
  await rm(join(repo.path, relPath));
  const response = await t.call(lookupDesignImpactOp, { id, paths: [relPath, 'unknown.ts', 'unknown.ts'] });
  expect(response.status).toBe(200);
  expect(lookupDesignImpactOp.output.parse(response.body)).toEqual({
    designId: id,
    snapshotSha: sha,
    dirty: false,
    coverage: { doneSections: 1, totalSections: 1 },
    candidates: [
      {
        targetKind: GitImpactTargetKind.File,
        targetId: file.id,
        title: relPath,
        relPath,
        classification: GitImpactClassification.Direct,
        distance: 0,
        sourcePath: relPath,
      },
      {
        targetKind: GitImpactTargetKind.Section,
        targetId: section.id,
        title: section.title,
        classification: GitImpactClassification.Direct,
        distance: 0,
        sourcePath: relPath,
      },
    ],
    uncoveredPaths: ['unknown.ts'],
    truncated: false,
  });
  expect(t.fake.sessions).toHaveLength(sessionCount);
  expect(t.app.services.designs.get(id)).toEqual(snapshot);
});

it('通过 HTTP 拒绝非法项目路径和超过上限的请求', async () => {
  for (const paths of [
    ['/etc/passwd'],
    ['../outside.ts'],
    ['src/../entry.ts'],
    ['C:/entry.ts'],
    ['src\\entry.ts'],
    ['src/\0entry.ts'],
    Array.from({ length: DESIGN_IMPACT_LOOKUP_MAX_PATHS + 1 }, (_, index) => `file-${index}.ts`),
  ]) {
    const response = await t.call(lookupDesignImpactOp, { id: 'missing', paths });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });
  }
  const response = await t.call(lookupDesignImpactOp, { id: 'missing', paths: ['src/entry.ts'] });
  expect(response.status).toBe(404);
  expect(response.body).toMatchObject({ error: { code: ErrorCode.DesignNotFound } });
});
