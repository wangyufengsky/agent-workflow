import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AttemptKind,
  cancelTaskOp,
  deleteTaskOp,
  getAttemptContextOp,
  RoleBaseAgent,
  updateSettingsOp,
} from '@aw/shared';
import type { Messages } from '@aw/shared/context';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask } from '../../../test/helpers/tasks.ts';
import { systemClock } from '../../core/clock.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { createModelSlotsModule } from '../model-slots/index.ts';
import { createSettingsModule } from '../settings/index.ts';
import { createSessionDispatcher, SessionPurpose } from './opencode.dispatch.ts';
import { createContextSummaries } from './opencode.summaries.ts';

it('同一物理会话单飞行，满槽跳过，切换尝试后释放 Worker 并丢弃迟到回复', async () => {
  const t = await createTestApp();
  const { repo, project } = await addProject(t);
  const task = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
  const database = openDatabase(join(t.dataDir, DATABASE_FILE), join(import.meta.dirname, '../../../migrations'));
  const settings = createSettingsModule({
    db: database.db,
    clock: systemClock,
    events: t.app.events,
    validate: () => {},
    validateEffort: async () => {},
  }).service;
  const slots = createModelSlotsModule({ settings, events: t.app.events, log: t.app.log }).service;
  const sessions = createSessionDispatcher({ opencode: t.fake, clock: systemClock, log: t.app.log, slots });
  const attempts = t.app.services.attempts;
  const deps = {
    db: database.db,
    clock: systemClock,
    log: t.app.log,
    opencode: t.fake,
    sessions,
    enabled: () => true,
    ownerSignal: (owner: { id: string }, sessionId: string) => attempts.delegationSignal(owner.id, sessionId),
  };
  const summaries = createContextSummaries(deps);
  const entered = Promise.withResolvers<{ sessionId: string; directory: string; signal: AbortSignal }>();
  const reply = Promise.withResolvers<string>();
  let requests = 0;
  t.fake.promptDocument = async (input) => {
    requests++;
    if (!input.signal) throw new Error('Worker has no cancellation signal');
    entered.resolve({ ...input, signal: input.signal });
    return reply.promise;
  };
  try {
    t.fake.enqueue(script().hang());
    const first = await attempts.start({
      taskId: task.id,
      projectId: project.id,
      nodeId: null,
      roleId: null,
      kind: AttemptKind.Plan,
      agent: RoleBaseAgent.Planner,
      directory: repo.path,
      title: 'Summary owner',
      model: 'opencode/fake-model',
      prompt: 'Plan',
    });
    const sessionId = first.opencodeSessionId;
    if (!sessionId) throw new Error('Missing first session');
    const job = {
      recallTool: 'agent-workflow_recall',
      owner: { kind: 'attempt' as const, id: first.id, taskId: task.id },
      sessionId,
      directory: repo.path,
      model: 'opencode/fake-model',
      source: 'prior evidence '.repeat(100),
      uptoMessageId: 'msg_old',
    };
    slots.setBackgroundBusy(slots.usage().limit);
    await summaries.generate(job);
    expect(requests).toBe(0);
    expect(slots.request({ id: 'waiting', grant: () => {}, moved: () => {} })).toBe(false);
    slots.setBackgroundBusy(0);
    await summaries.generate(job);
    expect(requests).toBe(0);
    slots.cancel('waiting');
    const pending = summaries.generate(job);
    const worker = await entered.promise;
    expect(slots.usage().inUse).toBe(1);
    expect(t.fake.sessions.find((s) => s.id === worker.sessionId)?.permission).toEqual([
      { permission: '*', pattern: '*', action: 'deny' },
    ]);
    expect(existsSync(worker.directory)).toBe(true);
    await summaries.generate(job);
    expect(requests).toBe(1);
    await attempts.abort(first.id);
    await pending;
    expect(worker.signal.aborted).toBe(true);
    expect(t.fake.aborts).toContain(worker.sessionId);
    expect(existsSync(worker.directory)).toBe(false);
    expect(slots.usage().inUse).toBe(0);
    t.fake.enqueue(script().hang());
    const next = await attempts.dispatchObjectAttempt({
      purpose: SessionPurpose.PlanningRevision,
      previousId: first.id,
      followUp: () => ({ agent: RoleBaseAgent.Planner, system: undefined, prompt: 'Revise' }),
    });
    expect(next.opencodeSessionId).toBe(sessionId);
    reply.resolve('late summary');
    await summaries.generate(job);
    expect(summaries.get(sessionId)).toBeUndefined();
    t.fake.promptDocument = async ({ text }) => text.slice(0, text.indexOf(' '));
    for (const id of ['msg_z', 'msg_a'])
      await summaries.generate({
        ...job,
        owner: { ...job.owner, id: next.id },
        uptoMessageId: id,
        source: `${id} evidence`,
      });
    const reopened = createContextSummaries(deps);
    try {
      expect(reopened.get(sessionId)).toMatchObject({ uptoMessageId: 'msg_a', summaryText: 'msg_a' });
    } finally {
      reopened.close();
    }
    // 重启后仍能查看持久摘要；重建的窗口装得下原始证据。
    t.fake.sessionMessages = async () =>
      [
        {
          info: { id: 'msg_a', sessionID: sessionId, role: 'assistant', time: { completed: 1 } },
          parts: [
            {
              type: 'tool',
              tool: 'grep',
              id: 'p',
              messageID: 'msg_a',
              sessionID: sessionId,
              state: { status: 'completed', output: 'found '.repeat(900), time: {}, input: {} },
            },
          ],
        },
        { info: { id: 'latest', role: 'user', agent: 'aw-planner' }, parts: [{ type: 'text', text: 'continue' }] },
        {
          info: {
            id: 'last-tool',
            role: 'assistant',
            time: { completed: 2 },
            tokens: { input: 5, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: 'tool', tool: 'grep', state: { status: 'completed', input: {}, output: 'ok' } }],
        },
      ] as unknown as Messages;
    await t.call(updateSettingsOp, { 'ai.contextEngine': false });
    const { body: detail } = await t.call(getAttemptContextOp, { id: next.id });
    expect(detail).toMatchObject({ budget: null, reconstructed: true, summary: { summaryText: 'msg_a' } });
    expect(detail.historyParts.summary).toBe(0);
    expect(detail.messages.find((message) => message.id === 'msg_a')).toMatchObject({
      status: 'kept',
      preview: expect.stringContaining('found found found'),
    });
    expect(detail.historyParts.system).toBeGreaterThan(0);
    expect(detail.historyParts.tools).toBeGreaterThan(0);
    const model = t.fake.models.find((m) => m.modelId === 'fake-model');
    if (!model) throw new Error('Missing fake-model');
    model.inputBudget = 2000;
    const { body: tight } = await t.call(getAttemptContextOp, { id: next.id });
    expect(tight.limit).toBe(2000);
    expect(tight.messages.find((message) => message.id === 'msg_a')).toMatchObject({ status: 'summarized' });
    const waiting = Promise.withResolvers<void>(),
      late = Promise.withResolvers<string>();
    t.fake.promptDocument = async () => {
      waiting.resolve();
      return late.promise;
    };
    const stale = summaries.generate({ ...job, owner: { ...job.owner, id: next.id }, uptoMessageId: 'old-window' });
    await waiting.promise;
    t.fake.replay([{ type: 'compacted', sessionId }]);
    await stale;
    late.resolve('late result from old window');
    expect(summaries.get(sessionId)).toBeUndefined();
    t.fake.promptDocument = async () => 'new window';
    await summaries.generate({ ...job, owner: { ...job.owner, id: next.id }, uptoMessageId: 'new-window' });
    expect(summaries.get(sessionId)?.summaryText).toBe('new window');
    await t.fake.deleteSession({ sessionId, directory: repo.path });
    expect(summaries.get(sessionId)).toBeUndefined();
    await attempts.abort(next.id);
    // 一个仍有保留会话的任务由实际任务删除入口级联清理。
    t.fake.enqueue(script().hang());
    const last = await attempts.start({
      taskId: task.id,
      projectId: project.id,
      nodeId: null,
      roleId: null,
      kind: AttemptKind.Plan,
      agent: RoleBaseAgent.Planner,
      directory: repo.path,
      title: 'Retained session',
      model: null,
      prompt: 'Plan',
    });
    const retainedId = last.opencodeSessionId;
    if (!retainedId) throw new Error('Missing retained session');
    await summaries.generate({ ...job, owner: { ...job.owner, id: last.id }, sessionId: retainedId });
    expect(summaries.get(retainedId)).toBeDefined();
    await attempts.abort(last.id);
    await t.call(cancelTaskOp, { id: task.id });
    expect((await t.call(deleteTaskOp, { id: task.id })).status).toBe(204);
    expect(summaries.get(retainedId)).toBeUndefined();
  } finally {
    reply.resolve('done');
    summaries.close();
    await sessions.close();
    slots.dispose();
    database.close();
    await t.close();
  }
});
