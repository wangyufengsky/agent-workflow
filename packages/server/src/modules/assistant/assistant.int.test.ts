import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssistantConversationDTO,
  type AssistantPageRef,
  abortAssistantOp,
  createConversationOp,
  deleteConversationOp,
  ErrorCode,
  getConversationOp,
  listAssistantFilesOp,
  listConfirmationsOp,
  listConversationsOp,
  OPENCODE_ASSISTANT_AGENT,
  readonlyBashRules,
  replyAssistantPermissionOp,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask } from '../../../test/helpers/tasks.ts';

let t: TestApp;
const HOME: AssistantPageRef = { page: 'home', params: {} };

beforeEach(async () => {
  t = await createTestApp({ clock: createFakeClock(Date.UTC(2025, 9, 9, 20, 30, 0)), timeZone: 'Asia/Shanghai' });
});
afterEach(() => t.close());

async function newConversation(): Promise<AssistantConversationDTO> {
  return (await t.call(createConversationOp, {})).body;
}

/** Subscribe before acting (07 §4). */
const becomesIdle = (id: string) =>
  waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);

async function transcript(id: string): Promise<TranscriptPage> {
  const res = await t.request({ method: 'GET', url: `/assistant/conversations/${id}/transcript` });
  return JSON.parse(res.body);
}

async function say(id: string, text: string, context: AssistantPageRef = HOME) {
  const idle = becomesIdle(id);
  const res = await t.call(sendAssistantMessageOp, { id, text, context });
  await idle;
  return res;
}

describe('助手对话（A-02、A-03）', () => {
  it('新建 → 列表 → 发送 → 消息流：对话以第一条消息的首行为标题', async () => {
    const c = await newConversation();
    t.fake.enqueue(script().text('明天是 10 月 11 日。'), { agent: OPENCODE_ASSISTANT_AGENT });
    await say(c.id, '明天几号？\n顺便列出项目');

    expect((await t.call(listConversationsOp, {})).body.items).toEqual([
      expect.objectContaining({ id: c.id, title: '明天几号？', busy: false }),
    ]);
    const { entries } = await transcript(c.id);
    expect(entries.map((e) => [e.kind, e.data])).toEqual([
      ['user_message', { text: '明天几号？\n顺便列出项目' }],
      ['text', { text: '明天是 10 月 11 日。' }],
    ]);
  });

  it('会话在助手目录中以 aw-assistant 运行，bash 为只读规则，每轮 system 写明时间、时区、模式与所在页面', async () => {
    const { project } = await addProject(t);
    const task = await createTask(t, { projectId: project.id, workflow: 'feature', start: false });
    const c = await newConversation();
    await say(c.id, '这个任务怎么样了？', { page: 'task', params: { taskId: task.id } });

    expect(t.fake.sessions).toEqual([
      expect.objectContaining({
        directory: join(t.dataDir, 'assistant'),
        agent: OPENCODE_ASSISTANT_AGENT,
        permission: readonlyBashRules(),
      }),
    ]);
    const [sent] = t.fake.prompts;
    expect(sent).toMatchObject({ agent: OPENCODE_ASSISTANT_AGENT, text: '这个任务怎么样了？' });
    expect(sent?.system).toContain('2025-10-10T04:30:00+08:00 (Friday), time zone Asia/Shanghai (UTC+08:00)');
    expect(sent?.system).toContain('Interface mode: simple');
    expect(sent?.system).toContain(`task ${task.key} "${task.title}" (task id ${task.id}`);
    expect(sent?.system).toContain(`files/${c.id}/`);
  });

  it('所在页面指向不存在的任务时不发送（TASK_NOT_FOUND）', async () => {
    const c = await newConversation();
    const res = await t.call(sendAssistantMessageOp, {
      id: c.id,
      text: '看看',
      context: { page: 'task', params: { taskId: 'gone' } },
    });
    expect(res.body).toMatchObject({ error: { code: ErrorCode.TaskNotFound } });
    expect(t.fake.prompts).toEqual([]);
  });

  it('回复中再发送返回 ASSISTANT_BUSY；停止后对话空闲，消息流记为已中止', async () => {
    const c = await newConversation();
    t.fake.enqueue(script().hang(), { agent: OPENCODE_ASSISTANT_AGENT });
    await t.call(sendAssistantMessageOp, { id: c.id, text: '做件长事', context: HOME });

    const again = await t.call(sendAssistantMessageOp, { id: c.id, text: '还有', context: HOME });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: ErrorCode.AssistantBusy } });

    const idle = becomesIdle(c.id);
    await t.call(abortAssistantOp, { id: c.id });
    await idle;
    const { entries } = await transcript(c.id);
    expect(entries.at(-1)).toMatchObject({ kind: 'system', data: { event: 'aborted' } });
  });

  it('权限请求出现在对话中，回复后会话继续', async () => {
    const c = await newConversation();
    t.fake.enqueue(script().requestPermission('bash', ['rm -rf build']).text('删好了'), {
      agent: OPENCODE_ASSISTANT_AGENT,
    });
    const asked = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (d) => d.id === c.id && d.pendingPermissions.length === 1,
    );
    await t.call(sendAssistantMessageOp, { id: c.id, text: '删掉 build', context: HOME });
    const [request] = (await asked).pendingPermissions;
    if (request === undefined) throw new Error('no permission request');
    expect(request).toMatchObject({ permission: 'bash', patterns: ['rm -rf build'] });

    const idle = becomesIdle(c.id);
    const res = await t.call(replyAssistantPermissionOp, {
      id: c.id,
      permissionId: request.permissionId,
      reply: 'once',
    });
    expect(res.body.pendingPermissions).toEqual([]);
    await idle;
    expect(t.fake.permissionReplies).toEqual([{ permissionId: request.permissionId, reply: 'once' }]);
    expect((await transcript(c.id)).entries.at(-1)).toMatchObject({ kind: 'text', data: { text: '删好了' } });
  });

  it('写入对话文件目录的文件作为附件出现，删除对话时连同确认、消息流与文件一起删除', async () => {
    const c = await newConversation();
    t.fake.enqueue(
      script().edit(`files/${c.id}/周报.md`, '# 周报').callAppTool('projects_update', { id: 'p1', name: 'x' }),
      { agent: OPENCODE_ASSISTANT_AGENT },
    );
    await say(c.id, '写一份周报');

    const { entries } = await transcript(c.id);
    expect(entries.filter((e) => e.kind === 'attachment').map((e) => e.data)).toEqual([{ path: '周报.md' }]);
    expect((await t.call(listAssistantFilesOp, { id: c.id })).body.items).toEqual([
      expect.objectContaining({ path: '周报.md', size: 8 }),
    ]);
    expect((await t.call(listConfirmationsOp, { id: c.id })).body.items).toHaveLength(1);

    const res = await t.call(deleteConversationOp, { id: c.id });
    expect(res.status).toBe(204);
    expect((await t.call(getConversationOp, { id: c.id })).body).toMatchObject({
      error: { code: ErrorCode.AssistantConversationNotFound },
    });
    expect(existsSync(join(t.dataDir, 'assistant', 'files', c.id))).toBe(false);
    expect(existsSync(join(t.dataDir, 'assistant', 'conversations', `${c.id}.jsonl`))).toBe(false);
  });
});
