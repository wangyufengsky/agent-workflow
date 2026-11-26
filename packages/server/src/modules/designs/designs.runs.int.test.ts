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
  InboxKind,
  MCP_TOOL_PREFIX,
  McpToolName,
  OPENCODE_AGENT_NAME,
  readonlyBashRules,
  restoreDesignSectionOp,
  reviewDesignOp,
  reviseDesignOutlineOp,
  reviseDesignSectionOp,
  ServerEventType,
  stopDesignOp,
  updateDesignOutlineOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, inboxOpens } from '../../../test/helpers/tasks.ts';

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
  expect(t.fake.sessions[0]).toMatchObject({
    directory: path,
    ...DESIGNER,
    permission: [
      ...readonlyBashRules(),
      ...[McpToolName.SubmitDesignOutline, McpToolName.ReportProgress, McpToolName.Recall].map((name) => ({
        permission: MCP_TOOL_PREFIX + name,
        action: 'allow',
        pattern: '*',
      })),
    ],
  });

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
      .callTool(McpToolName.SubmitDesignSection, section(overview.id, originalSummary)),
    DESIGNER,
  );
  const waiting = inboxOpens(t, InboxKind.Permission);
  t.fake.enqueue(script().requestPermission('bash', ['rg -n endpoint src/endpoint.ts']).hang(), DESIGNER);
  const parallel = await Promise.all([t.call(generateDesignOp, { id }), t.call(generateDesignOp, { id })]);
  expect(parallel.map(({ status }) => status).sort()).toEqual([200, 409]);
  expect(parallel.find(({ status }) => status === 409)?.raw.json()).toMatchObject({
    error: { code: ErrorCode.DesignBusy },
  });
  await waiting;

  const running = await get(id);
  expect(running).toMatchObject({ status: DesignStatus.Generating, doneSections: 1, totalSections: 3 });
  expect(running.outlineConfirmedAt).not.toBeNull();
  expect(
    running.runs.slice(-2).map(({ targetSectionIds, doneSectionIds }) => ({ targetSectionIds, doneSectionIds })),
  ).toEqual([
    { targetSectionIds: [overview.id], doneSectionIds: [overview.id] },
    { targetSectionIds: [endpoint.id], doneSectionIds: [] },
  ]);
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

it('单章失败保留前章，停止本次队列，定向重试后仍保留未选为目标的章节', async () => {
  const { id } = await createDraft(false);
  const { overview, endpoint, flow } = await optimize(id);
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(overview.id, '已生成')), DESIGNER);
  t.fake.enqueue(script().error('ContextOverflowError', '单章已超过上下文窗口'), DESIGNER);

  const failed = ended(AttemptKind.DesignGenerate, AttemptStatus.Failed);
  expect((await t.call(generateDesignOp, { id, model: null })).status).toBe(200);
  await failed;
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
    { status: AttemptStatus.Succeeded, targetSectionIds: [overview.id], doneSectionIds: [overview.id] },
    { status: AttemptStatus.Failed, targetSectionIds: [endpoint.id], doneSectionIds: [] },
  ]);
  expect(design.sections.find(({ id }) => id === overview.id)?.summary).toBe('已生成');
  expect(design.runs.at(-1)?.attempt.error?.message).toContain('单章已超过上下文窗口');
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(endpoint.id, '手动重试完成')), DESIGNER);
  const retried = ended(AttemptKind.DesignGenerate);
  expect((await t.call(generateDesignOp, { id, sectionId: endpoint.id })).status).toBe(200);
  await retried;
  await t.fake.settled();
  const completed = await get(id);
  expect(completed).toMatchObject({ status: DesignStatus.Incomplete, doneSections: 2 });
  expect(completed.runs).toHaveLength(design.runs.length + 1);
  expect(completed.runs.at(-1)?.targetSectionIds).toEqual([endpoint.id]);
  expect(completed.sections.find(({ id }) => id === flow.id)?.blocks).toBeNull();
});

it('每章使用独立会话与授权范围，最后独立复审', async () => {
  const { id } = await createDraft(true);
  const { overview, endpoint, flow } = await optimize(id);
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, section(overview.id, '总览说明仅留在第一章')),
    DESIGNER,
  );
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignSection, section(endpoint.id, '端点说明仅留在第二章')),
    DESIGNER,
  );
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(flow.id, '流程完成')), DESIGNER);
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitDesignReview, {
      findings: [feedback(overview.id), feedback(endpoint.id), feedback(flow.id)],
    }),
    DESIGNER,
  );

  const reviewed = ended(AttemptKind.DesignReview);
  expect((await t.call(generateDesignOp, { id, model: null })).status).toBe(200);
  await reviewed;
  await t.fake.settled();
  const design = await get(id);
  expect(design).toMatchObject({ status: DesignStatus.Ready, doneSections: 3, totalSections: 3 });
  expect(
    design.runs
      .slice(1)
      .map(({ kind, attempt, targetSectionIds, doneSectionIds }) => [
        kind,
        attempt.status,
        targetSectionIds,
        doneSectionIds,
      ]),
  ).toEqual([
    [DesignRunKind.Generate, AttemptStatus.Succeeded, [overview.id], [overview.id]],
    [DesignRunKind.Generate, AttemptStatus.Succeeded, [endpoint.id], [endpoint.id]],
    [DesignRunKind.Generate, AttemptStatus.Succeeded, [flow.id], [flow.id]],
    [
      DesignRunKind.Review,
      AttemptStatus.Succeeded,
      [overview.id, endpoint.id, flow.id],
      [overview.id, endpoint.id, flow.id],
    ],
  ]);
  const [initial, next, last, review] = t.fake.prompts.slice(1);
  if (!initial || !next || !last || !review) throw new Error('Expected generation and review sessions');
  expect(new Set([initial, next, last, review].map(({ sessionId }) => sessionId)).size).toBe(4);
  expect(next.text).toContain(`"id":"${overview.id}"`);
  expect(next.text).toContain(`"id":"${flow.id}"`);
  expect(next.text).toContain('src/endpoint.ts');
  expect(next.text).not.toContain('README.md');
  expect(next.text).not.toContain('总览说明仅留在第一章');
  expect(last.text).not.toContain('端点说明仅留在第二章');
  expect(review.text).toContain('端点说明仅留在第二章');
});

it('在已提交章节释放模型槽之前可以停止切章', async () => {
  const { id } = await createDraft(false);
  const { overview, endpoint } = await optimize(id);
  const endCommandStarted = Promise.withResolvers<void>();
  const releaseEndCommand = Promise.withResolvers<void>();
  const abort = t.fake.abort;
  t.fake.abort = async (input) => {
    endCommandStarted.resolve();
    await releaseEndCommand.promise;
    return abort(input);
  };
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(overview.id, '首章完成')).hang(), DESIGNER);
  const finished = ended(AttemptKind.DesignGenerate);
  try {
    expect((await t.call(generateDesignOp, { id })).status).toBe(200);
    await finished;
    await endCommandStarted.promise;
    const during = await get(id);
    expect(during.doneSections).toBe(1);
    expect(during).toMatchObject({ activeRunId: null, handoffPending: true });
    expect(during.runs.at(-1)?.attempt.status).toBe(AttemptStatus.Succeeded);
    expect((await t.call(generateDesignOp, { id })).status).toBe(409);
    const stopped = await t.call(stopDesignOp, { id });
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ activeRunId: null, handoffPending: false });
  } finally {
    releaseEndCommand.resolve();
  }
  await t.fake.settled();
  const stopped = await get(id);
  expect(stopped).toMatchObject({ status: DesignStatus.Incomplete, doneSections: 1, handoffPending: false });
  expect(stopped.runs.at(-1)?.targetSectionIds).toEqual([overview.id]);
  expect(stopped.sections.find(({ id }) => id === endpoint.id)?.blocks).toBeNull();
  expect(t.fake.prompts).toHaveLength(2);
});

it('应用重启保留已提交的章节，仅在用户点击继续后补跑', async () => {
  const { id } = await createDraft(false);
  const { overview, endpoint, flow } = await optimize(id);
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(overview.id, '重启前完成')), DESIGNER);
  t.fake.enqueue(script().requestPermission('bash', ['rg -n endpoint src/endpoint.ts']).hang(), DESIGNER);
  const waiting = inboxOpens(t, InboxKind.Permission);
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  await waiting;
  expect(await get(id)).toMatchObject({ status: DesignStatus.Generating, doneSections: 1 });
  const dataDir = t.dataDir;
  await t.close();
  t = await createTestApp({ dataDir });
  const restarted = await get(id);
  expect(restarted).toMatchObject({ status: DesignStatus.Incomplete, activeRunId: null, doneSections: 1 });
  expect(restarted.sections[0]?.summary).toBe('重启前完成');
  expect(t.fake.prompts).toHaveLength(0);

  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(endpoint.id, '续作端点')), DESIGNER);
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(flow.id, '续作流程')), DESIGNER);
  let successes = 0;
  const completed = waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    ({ attempt }) =>
      attempt.kind === AttemptKind.DesignGenerate && attempt.status === AttemptStatus.Succeeded && ++successes === 2,
  );
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  await completed;
  expect(await get(id)).toMatchObject({ status: DesignStatus.Ready, doneSections: 3 });
  expect((await get(id)).runs.slice(-2).map(({ targetSectionIds }) => targetSectionIds)).toEqual([
    [endpoint.id],
    [flow.id],
  ]);
  expect(t.fake.prompts).toHaveLength(2);
});

it.each([1, 5])('按 AI 提交的 %i 章自动派工，每个会话收尾后才交接', async (count) => {
  const { id } = await createDraft(true);
  await t.call(updateSettingsOp, {
    'ai.sessionStartCommand': '/report start',
    'ai.sessionEndCommand': '/report complete',
  });
  const commands: [string, string][] = [];
  const planningSubmitted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(t.fake, 'runCommand').mockImplementation(async ({ sessionId, text }) => {
    commands.push([sessionId, text]);
    if (commands.length === 2) {
      planningSubmitted.resolve();
      await release.promise;
    }
  });
  const chapters = Array.from({ length: count }, (_, i) => ({
    kind: DesignSectionKind.Flow,
    title: `业务流程 ${i + 1}`,
    scopePaths: ['src'],
  }));
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignOutline, { sections: chapters }), DESIGNER);
  let reviews = 0;
  const reviewComplete = waitForEvent(
    t.app.events,
    ServerEventType.AttemptUpdated,
    ({ attempt }) =>
      attempt.kind === AttemptKind.DesignReview &&
      attempt.status === AttemptStatus.Succeeded &&
      ++reviews === Math.ceil(count / 4),
  );
  try {
    expect((await t.call(reviseDesignOutlineOp, { id, generateAfterPlanning: true })).status).toBe(200);
    await planningSubmitted.promise;
    const draft = await get(id);
    expect(draft).toMatchObject({ handoffPending: true, totalSections: count, outlineConfirmedAt: null });
    expect(draft.runs).toHaveLength(1);
    for (const chapter of draft.sections) {
      t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(chapter.id, chapter.title)), DESIGNER);
    }
    for (let i = 0; i < count; i += 4) {
      t.fake.enqueue(
        script().callTool(McpToolName.SubmitDesignReview, {
          findings: draft.sections.slice(i, i + 4).map(({ id }) => feedback(id)),
        }),
        DESIGNER,
      );
    }
  } finally {
    release.resolve();
  }
  await t.app.services.attempts.waitForSessionRelease((await reviewComplete).attempt.id);
  const reviewed = await get(id);
  expect(reviewed.sections.map(({ reviewState }) => reviewState)).toEqual(chapters.map(() => DesignReviewState.Passed));
  expect(reviewed.runs.map(({ kind }) => kind)).toEqual([
    DesignRunKind.Outline,
    ...chapters.map(() => DesignRunKind.Generate),
    ...Array.from({ length: Math.ceil(count / 4) }, () => DesignRunKind.Review),
  ]);
  expect(commands).toEqual(
    t.fake.sessions.flatMap(({ id }) => [
      [id, '/report start'],
      [id, '/report complete'],
    ]),
  );

  const chapter = reviewed.sections[0];
  if (!chapter) throw new Error('Expected a generated chapter');
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, section(chapter.id, '修订')), DESIGNER);
  const revised = ended(AttemptKind.DesignRevise);
  expect((await t.call(reviseDesignSectionOp, { id, sectionId: chapter.id, instruction: '核对入口' })).status).toBe(
    200,
  );
  await t.app.services.attempts.waitForSessionRelease((await revised).attempt.id);

  expect(commands).toEqual(
    t.fake.sessions.flatMap(({ id }) => [
      [id, '/report start'],
      [id, '/report complete'],
    ]),
  );
});
