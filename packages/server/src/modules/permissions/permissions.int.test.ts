import {
  createConversationOp,
  getConversationOp,
  listInboxOp,
  resolveInboxOp,
  setTaskPermissionModeOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, inboxOpens, nodeReaches } from '../../../test/helpers/tasks.ts';

it('运行中的任务切档仅影响后续请求，保留当前审批卡和对话自己的模式', async () => {
  const t = await createTestApp();
  try {
    const { project } = await addProject(t, { checkCommand: null });
    const chat = (await t.call(createConversationOp, { projectId: project.id })).body;
    t.fake.enqueue(
      script()
        .requestPermission('bash', ['first'])
        .requestPermission('bash', ['next'])
        .callTool('submit_result', { summary: '定位完成' }),
      { title: '定位根因' },
    );
    t.fake.enqueue(script().hang(), { title: '修复' });
    const asked = inboxOpens(t, 'permission');
    const task = await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    const { item } = await asked;
    expect(task.permissionMode).toBe('ask');
    expect((await t.call(setTaskPermissionModeOp, { id: task.id, permissionMode: 'full' })).body.permissionMode).toBe(
      'full',
    );
    expect((await t.call(getConversationOp, { id: chat.id })).body.permissionMode).toBe('ask');
    expect((await t.call(listInboxOp, { taskId: task.id, status: 'open' })).body.items.map((i) => i.id)).toContain(
      item.id,
    );
    const fixing = nodeReaches(t, 'fix', 'running');
    await t.call(resolveInboxOp, { id: item.id, response: { decision: 'once' } });
    await fixing;
    expect(t.fake.permissionReplies.map((r) => r.reply)).toEqual(['once', 'once']);
  } finally {
    await t.close();
  }
});
