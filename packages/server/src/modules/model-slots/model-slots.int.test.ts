import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AssistantPage,
  AssistantTurnStatus,
  AttemptKind,
  AttemptStatus,
  abortAssistantOp,
  createConversationOp,
  ErrorCode,
  getConversationOp,
  getModelSlotsOp,
  gitDraftCommitMessageOp,
  gitStageOp,
  ServerEventType,
  sendAssistantMessageOp,
  startGitReviewOp,
  stopGitReviewOp,
  updateSettingsOp,
  whisperOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock, type FakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

const REVIEWER = { agent: 'aw-code-reviewer' };
const ASSISTANT = { agent: 'aw-assistant' };
const HOME = { page: AssistantPage.Home, params: {} };

let t: TestApp;
let clock: FakeClock;
beforeEach(async () => {
  clock = createFakeClock();
  t = await createTestApp({ clock });
  await t.call(updateSettingsOp, { 'scheduler.maxConcurrentAttempts': 1 });
});
afterEach(() => t.close());

const assistantText = (id: string) =>
  waitForEvent(
    t.app.events,
    ServerEventType.AssistantTranscript,
    (d) => d.conversationId === id && d.entries.some((e) => e.kind === 'text'),
  );

/** The one model slot is taken by an assistant turn that keeps working. */
async function busyAssistant() {
  const id = (await t.call(createConversationOp, {})).body.id;
  const working = assistantText(id);
  t.fake.enqueue(script().text('正在工作').hang(), ASSISTANT);
  await t.call(sendAssistantMessageOp, { id, text: '先做这个', context: HOME });
  await working;
  return id;
}

describe('所有模型会话共享一个并发上限（D186）', () => {
  it('助手一轮排在 Git 审查之后：显示排队位置，排队的时间不算时限，轮到后从头计时', async () => {
    await t.call(updateSettingsOp, { 'attempt.timeoutMinutes': 1 });
    const { repo, project } = await addProject(t);
    await writeFile(join(repo.path, 'notes.md'), 'new\n');
    t.fake.enqueue(script().hang(), REVIEWER);
    const { body: review } = await t.call(startGitReviewOp, { id: project.id, target: { kind: 'worktree' } });

    const id = (await t.call(createConversationOp, {})).body.id;
    t.fake.enqueue(script().text('轮到我了').hang(), ASSISTANT);
    const shown = waitForEvent(t.app.events, ServerEventType.AssistantTranscript, (d) =>
      d.entries.some((e) => e.kind === 'user_message'),
    );
    const { body: queued } = await t.call(sendAssistantMessageOp, { id, text: '你好', context: HOME });
    expect(queued).toMatchObject({ busy: true, queuePosition: 1 });
    await shown;
    expect((await t.call(getModelSlotsOp, {})).body).toEqual({ inUse: 1, limit: 1, queued: 1 });
    clock.advance(2 * 60 * 60_000);
    expect(t.fake.prompts.filter((p) => p.agent === ASSISTANT.agent)).toEqual([]);

    const answered = assistantText(id);
    await t.call(stopGitReviewOp, { reviewId: review.id });
    await answered;
    expect((await t.call(getConversationOp, { id })).body).toMatchObject({ busy: true, queuePosition: null });
    clock.advance(59_999);
    expect((await t.call(getConversationOp, { id })).body.busy).toBe(true);
    const stopped = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
    clock.advance(1);
    await stopped;
    expect((await t.call(getConversationOp, { id })).body.usage.latest?.status).toBe(AssistantTurnStatus.TimedOut);
  });

  it('提交信息草拟排在助手之后：尝试为 queued，排队不算草拟的时限，轮到后照常返回草稿', async () => {
    const id = await busyAssistant();
    const { repo, project } = await addProject(t);
    await writeFile(join(repo.path, 'README.md'), '# changed\n');
    await t.call(gitStageOp, { id: project.id, paths: ['README.md'] });
    t.fake.enqueue(script().callTool('submit_commit_message', { subject: 'docs: retitle the readme' }), REVIEWER);
    const queued = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.kind === AttemptKind.CommitMessage && d.attempt.status === AttemptStatus.Queued,
    );
    const drafting = t.call(gitDraftCommitMessageOp, { id: project.id });
    expect((await queued).attempt.queuePosition).toBe(1);
    clock.advance(10 * 60_000);

    await t.call(abortAssistantOp, { id });
    const { status, body } = await drafting;
    expect([status, body]).toEqual([200, { subject: 'docs: retitle the readme', body: '' }]);
  });

  it('额度用满时桌宠碎碎念这次跳过：MODEL_SLOTS_FULL', async () => {
    await busyAssistant();
    const skipped = await t.call(whisperOp, {});
    expect([skipped.status, skipped.raw.json().error.code]).toEqual([409, ErrorCode.ModelSlotsFull]);
  });
});
