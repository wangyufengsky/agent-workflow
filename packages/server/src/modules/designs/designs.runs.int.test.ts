import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AttemptKind,
  AttemptStatus,
  createDesignOp,
  DesignReviewState,
  DesignRunKind,
  DesignSectionKind,
  DesignStatus,
  deleteDesignOp,
  deleteProjectOp,
  ErrorCode,
  exportDesignOp,
  generateDesignOp,
  getDesignOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  readonlyBashRules,
  restoreDesignSectionOp,
  reviewDesignOp,
  reviseDesignOutlineOp,
  reviseDesignSectionOp,
  ServerEventType,
  stopDesignOp,
  TranscriptEntryKind,
  updateDesignOutlineOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

const DESIGNER = { agent: OPENCODE_AGENT_NAME.designer };
const OUTLINE = [
  { kind: DesignSectionKind.Overview, title: '总览', scopePaths: [] },
  { kind: DesignSectionKind.Module, title: '端点', scopePaths: ['src/endpoint.ts'] },
  { kind: DesignSectionKind.Flow, title: '流程', scopePaths: ['src'] },
  { kind: DesignSectionKind.Custom, title: '跳过', scopePaths: ['src'] },
];
const section = (sectionId: string, summary: string) => ({
  sectionId,
  summary,
  blocks: [{ type: 'markdown', markdown: summary }],
  files: [],
  diagrams: [],
});
const feedback = (sectionId: string) => ({ sectionId, reviewState: DesignReviewState.Passed, notes: [] });

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const ended = (kind: AttemptKind, status: AttemptStatus = AttemptStatus.Succeeded) =>
  waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    ({ attempt }) => attempt.kind === kind && attempt.status === status,
  );
const get = async (id: string) => (await t.call(getDesignOp, { id })).body;

async function createDraft(aiReviewEnabled: boolean) {
  const { project, repo } = await addProject(t, {
    files: { 'src/endpoint.ts': 'export const endpoint = 1;\n', '.env': 'DEMO_SECRET=excluded\n' },
  });
  const created = await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ status: DesignStatus.OutlineReady, outlineConfirmedAt: null, runs: [] });
  expect(created.body.files.map(({ relPath }) => relPath)).toEqual(['README.md', 'src/endpoint.ts']);
  expect(t.fake.prompts).toEqual([]);
  return { id: created.body.id, projectId: project.id, path: repo.path };
}

async function optimize(id: string) {
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignOutline, { sections: OUTLINE }), DESIGNER);
  const outline = ended(AttemptKind.DesignOutline);
  expect((await t.call(reviseDesignOutlineOp, { id, instruction: '按入口梳理' })).status).toBe(200);
  await outline;
  const current = await get(id);
  const [overview, endpoint, flow] = current.sections;
  if (!overview || !endpoint || !flow) throw new Error('Expected AI to submit three working sections');
  const edited = await t.call(updateDesignOutlineOp, {
    id,
    sections: current.sections.map(({ id, kind, title, scopePaths }) => ({
      id,
      kind,
      title,
      scopePaths,
      selected: title !== '跳过',
    })),
  });
  expect(edited.status).toBe(200);
  return { overview, endpoint, flow };
}

it('扫描、优化、确认、增量提交、停止、单章重试、续作、复审和重写共享同一个 HTTP 工作台', async () => {
  const { id, projectId, path } = await createDraft(true);
  const { overview, endpoint, flow } = await optimize(id);
  const originalSummary = `初版总览 · 源码在 ${join(path, 'src', 'endpoint.ts')}`;
  expect(t.fake.sessions[0]).toMatchObject({ directory: path, ...DESIGNER, permission: readonlyBashRules() });

  const editedOutline = (await get(id)).sections.map(({ id, kind, title, scopePaths, selected }) => ({
    id,
    kind,
    title,
    scopePaths,
    selected,
  }));
  await t.call(updateDesignOutlineOp, { id, sections: editedOutline.map((item) => ({ ...item, selected: false })) });
  const emptyOutline = await t.call(generateDesignOp, { id });
  expect(emptyOutline.status).toBe(400);
  expect(emptyOutline.raw.json()).toMatchObject({
    error: { code: ErrorCode.ValidationFailed, details: { issues: [{ path: ['sections'] }] } },
  });
  expect(await get(id)).toMatchObject({ outlineConfirmedAt: null, status: DesignStatus.OutlineReady });
  await t.call(updateDesignOutlineOp, { id, sections: editedOutline });

  const beforeConfirmation = await t.call(generateDesignOp, { id, sectionId: overview.id });
  expect(beforeConfirmation.status).toBe(409);
  expect(beforeConfirmation.raw.json()).toMatchObject({ error: { code: ErrorCode.StateTransitionInvalid } });
  expect(await get(id)).toMatchObject({ outlineConfirmedAt: null, totalSections: 3, doneSections: 0 });

  t.fake.crash();
  const unavailable = await t.call(generateDesignOp, { id });
  expect(unavailable.raw.json()).toMatchObject({ error: { code: ErrorCode.OpencodeNotReady } });
  expect(await get(id)).toMatchObject({ outlineConfirmedAt: null, status: DesignStatus.OutlineReady });
  t.fake.reconnect();

  const bad = section(overview.id, '错误证据');
  t.fake.enqueue(
    script()
      .callTool(McpToolName.SubmitDesignSection, {
        ...bad,
        files: [{ relPath: '.env', responsibility: '错误分析', symbols: [] }],
      })
      .callTool(McpToolName.SubmitDesignSection, section(overview.id, originalSummary))
      .hang(),
    DESIGNER,
  );
  const firstAccepted = waitForEvent(t.app.events, ServerEventType.AttemptTranscript, ({ entries }) =>
    entries.some(
      ({ kind, data }) =>
        kind === TranscriptEntryKind.ToolResult &&
        data.tool.endsWith(McpToolName.SubmitDesignSection) &&
        data.status === 'completed',
    ),
  );
  const parallel = await Promise.all([t.call(generateDesignOp, { id }), t.call(generateDesignOp, { id })]);
  expect(parallel.map(({ status }) => status).sort()).toEqual([200, 409]);
  expect(parallel.find(({ status }) => status === 409)?.raw.json()).toMatchObject({
    error: { code: ErrorCode.DesignBusy },
  });
  await firstAccepted;

  const running = await get(id);
  expect(running).toMatchObject({ status: DesignStatus.Generating, doneSections: 1, totalSections: 3 });
  expect(running.outlineConfirmedAt).not.toBeNull();
  expect(running.runs.at(-1)).toMatchObject({
    targetSectionIds: [overview.id, endpoint.id, flow.id],
    doneSectionIds: [overview.id],
  });
  expect(t.fake.toolCalls.find(({ isError }) => isError)?.result).toMatchObject({
    code: ErrorCode.ValidationFailed,
    details: { issues: expect.any(Array) },
  });
  expect(JSON.stringify(t.fake.prompts)).not.toContain('DEMO_SECRET');
  expect((await t.call(deleteDesignOp, { id })).status).toBe(409);
  const stopped = await t.call(stopDesignOp, { id });
  expect(stopped.body).toMatchObject({ status: DesignStatus.Incomplete, doneSections: 1 });
  expect(stopped.body.runs.at(-1)?.attempt.status).toBe(AttemptStatus.Aborted);
  await t.fake.settled();

  const skipped = editedOutline.find((item) => !item.selected);
  if (!skipped) throw new Error('Fixture must have an unchecked section');
  for (const sectionId of [overview.id, skipped.id]) {
    const invalidRetry = await t.call(generateDesignOp, { id, sectionId });
    expect(invalidRetry.status).toBe(409);
    expect(invalidRetry.raw.json()).toMatchObject({ error: { code: ErrorCode.StateTransitionInvalid } });
  }
  expect(await get(id)).toMatchObject({ doneSections: 1, totalSections: 3 });

  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(flow.id, '流程内容')), DESIGNER);
  const retryEnded = ended(AttemptKind.DesignGenerate);
  expect((await t.call(generateDesignOp, { id, sectionId: flow.id })).status).toBe(200);
  await retryEnded;
  const afterRetry = await get(id);
  expect(afterRetry).toMatchObject({ status: DesignStatus.Incomplete, doneSections: 2 });
  expect(afterRetry.runs.at(-1)?.targetSectionIds).toEqual([flow.id]);
  expect(afterRetry.sections.find(({ id }) => id === endpoint.id)?.blocks).toBeNull();

  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(endpoint.id, '端点内容')), DESIGNER);
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignReview, {
      findings: [feedback(overview.id), feedback(endpoint.id), feedback(flow.id)],
    }),
    DESIGNER,
  );
  const reviewed = ended(AttemptKind.DesignReview);
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  await reviewed;
  await t.fake.settled();
  const finished = await get(id);
  expect(finished).toMatchObject({ status: DesignStatus.Ready, doneSections: 3 });
  expect(finished.runs.slice(-2).map(({ kind, targetSectionIds }) => [kind, targetSectionIds])).toEqual([
    [DesignRunKind.Generate, [endpoint.id]],
    [DesignRunKind.Review, [overview.id, endpoint.id, flow.id]],
  ]);
  expect(finished.sections.map(({ reviewState }) => reviewState)).toEqual([
    DesignReviewState.Passed,
    DesignReviewState.Passed,
    DesignReviewState.Passed,
    DesignReviewState.None,
  ]);
  expect(t.fake.prompts.at(-1)?.sessionId).not.toBe(t.fake.prompts.at(-2)?.sessionId);

  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignReview, {
      findings: [
        {
          sectionId: endpoint.id,
          reviewState: DesignReviewState.NeedsAttention,
          notes: [{ severity: 'warn', message: '入口用途需说明' }],
        },
      ],
    }),
    DESIGNER,
  );
  const spotChecked = ended(AttemptKind.DesignReview);
  expect((await t.call(reviewDesignOp, { id })).status).toBe(200);
  await spotChecked;
  const latestReview = await get(id);
  expect(latestReview.sections.map(({ reviewState, reviewNotes }) => [reviewState, reviewNotes])).toEqual([
    [DesignReviewState.None, null],
    [DesignReviewState.NeedsAttention, [{ severity: 'warn', message: '入口用途需说明' }]],
    [DesignReviewState.None, null],
    [DesignReviewState.None, null],
  ]);
  expect(latestReview.runs.at(-1)?.doneSectionIds).toEqual([endpoint.id]);

  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(overview.id, '重写总览')), DESIGNER);
  const revised = ended(AttemptKind.DesignRevise);
  expect(
    (
      await t.call(reviseDesignSectionOp, {
        id,
        sectionId: overview.id,
        focusPath: 'src/endpoint.ts',
        instruction: '补充入口定位',
      })
    ).status,
  ).toBe(200);
  await revised;
  let design = await get(id);
  expect(design.sections[0]).toMatchObject({ summary: '重写总览', hasPrevious: true });
  const restored = await t.call(restoreDesignSectionOp, { id, sectionId: overview.id });
  expect(restored.body.sections[0]?.summary).toBe(originalSummary);

  expect((await t.call(deleteProjectOp, { id: projectId })).status).toBe(204);
  design = await get(id);
  expect(design).toMatchObject({ projectId: null, status: DesignStatus.Ready });
  const protectedDir = join(path, 'docs', 'design');
  await mkdir(protectedDir, { recursive: true });
  const handWritten = join(protectedDir, 'notes.md');
  await writeFile(handWritten, '手写设计内容');
  const protectedExport = await t.call(exportDesignOp, { id, targetDir: protectedDir, overwrite: true });
  expect(protectedExport.status).toBe(400);
  expect(protectedExport.body).toMatchObject({ error: { code: ErrorCode.ValidationFailed } });
  expect(await readFile(handWritten, 'utf8')).toBe('手写设计内容');

  await rm(path, { recursive: true });
  const targetDir = join(t.dataDir, '已删除项目的离线站点');
  const detachedExport = await t.call(exportDesignOp, { id, targetDir });
  expect(detachedExport.status).toBe(200);
  for (const name of ['design-model.json', 'design-data.js']) {
    const contents = await readFile(join(targetDir, name), 'utf8');
    expect(contents).toContain('初版总览');
    expect(contents).toContain('[本机路径]');
    expect(contents).not.toContain(path);
  }

  expect((await t.call(reviseDesignSectionOp, { id, sectionId: overview.id, instruction: '不可再修改' })).status).toBe(
    409,
  );
  const attemptIds = design.runs.map(({ attempt }) => attempt.id);
  const transcript = (attemptId: string) => join(t.dataDir, 'runs', 'designs', `${attemptId}.jsonl`);
  expect(attemptIds.every((attemptId) => existsSync(transcript(attemptId)))).toBe(true);
  expect((await t.call(deleteDesignOp, { id })).status).toBe(204);
  expect((await t.call(getDesignOp, { id })).status).toBe(404);
  expect(attemptIds.every((attemptId) => !existsSync(transcript(attemptId)))).toBe(true);
  for (const attemptId of attemptIds) {
    expect(() => t.app.services.attempts.get(attemptId)).toThrow();
  }
});

it('有进展的上下文溢出只用新会话补剩余章节，下一次无进展溢出停止自动续作', async () => {
  const { id } = await createDraft(false);
  const { overview, endpoint, flow } = await optimize(id);
  t.fake.enqueue(
    script()
      .callTool(McpToolName.SubmitDesignSection, section(overview.id, '已生成'))
      .error('ContextOverflowError', '超出窗口'),
    DESIGNER,
  );
  t.fake.enqueue(script().error('ContextOverflowError', '仍然超出窗口'), DESIGNER);
  expect((await t.call(generateDesignOp, { id, model: null })).status).toBe(200);
  await t.fake.settled();
  const design = await get(id);
  expect(design).toMatchObject({ status: DesignStatus.Incomplete, doneSections: 1, totalSections: 3 });
  expect(
    design.runs.slice(1).map(({ attempt, targetSectionIds, doneSectionIds }) => ({
      status: attempt.status,
      targetSectionIds,
      doneSectionIds,
    })),
  ).toEqual([
    {
      status: AttemptStatus.Failed,
      targetSectionIds: [overview.id, endpoint.id, flow.id],
      doneSectionIds: [overview.id],
    },
    { status: AttemptStatus.Failed, targetSectionIds: [endpoint.id, flow.id], doneSectionIds: [] },
  ]);
  expect(t.fake.prompts.at(-1)?.sessionId).not.toBe(t.fake.prompts.at(-2)?.sessionId);
});
