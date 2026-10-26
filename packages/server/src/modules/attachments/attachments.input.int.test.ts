import { readFile } from 'node:fs/promises';
import {
  type AssistantPageRef,
  ATTACHMENT_NAME_HEADER,
  ATTACHMENT_ORPHAN_TTL_MS,
  ATTACHMENT_PROMPT_MAX_CHARS,
  type AttachmentDTO,
  createConversationOp,
  createTaskOp,
  deleteConversationOp,
  ErrorCode,
  getAttachmentOp,
  listTasksOp,
  OPENCODE_ASSISTANT_AGENT,
  requestChangesOp,
  ServerEventType,
  sendAssistantMessageOp,
  startTaskOp,
  type TranscriptPage,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';

const HOME: AssistantPageRef = { page: 'home', params: {} };

let t: TestApp;
let clock: ReturnType<typeof createFakeClock>;
beforeEach(async () => {
  clock = createFakeClock();
  t = await createTestApp({ clock });
});
afterEach(() => t.close());

async function uploaded(content: string | Buffer, name: string): Promise<AttachmentDTO> {
  const res = await t.request({
    method: 'POST',
    url: '/attachments',
    headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: encodeURIComponent(name) },
    payload: content,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** The first message of the session whose title contains `title`. */
function promptTo(title: string): string {
  const session = t.fake.sessions.find((s) => s.title.includes(title));
  const prompt = t.fake.prompts.find((p) => p.sessionId === session?.id);
  if (prompt === undefined) throw new Error(`No prompt to ${title}`);
  return prompt.text;
}

const salesXlsx = () => readFile(new URL('../../../test/fixtures/office/sales.libreoffice.xlsx', import.meta.url));
const byRegion = {
  sheet: '明细',
  group_by: ['区域'],
  aggregates: [{ fn: 'sum', column: '金额' }],
  order_by: [{ column: 'sum(金额)', desc: true }],
};

const toolResult = (name: string, index = 0) => t.fake.toolCalls.filter((c) => c.name === name)[index];

const reaches = (taskId: string, status: string) =>
  waitForEvent(t.app.events, ServerEventType.TaskUpdated, (d) => d.id === taskId && d.status === status);

describe('任务的附件（30 §3.2）', () => {
  it('每个步骤都看到需求的附件；长附件只放开头、用 read_attachment 读完；「再改改」的附件从那一步起可见', async () => {
    const { project } = await addProject(t);
    const notes = await uploaded('订单号是 12 位数字\n', 'notes.md');
    const log = await uploaded(`${'x'.repeat(ATTACHMENT_PROMPT_MAX_CHARS)}TAIL`, 'app.log');
    const unrelated = await uploaded('not this task\n', 'other.md');
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: 'Fix the order search',
      start: false,
      attachmentIds: [notes.id, log.id],
    });
    const directory = `/${task.key}`;
    const share = Math.floor(ATTACHMENT_PROMPT_MAX_CHARS / 2);
    t.fake.enqueue(
      script()
        .callTool('read_attachment', { attachment_id: log.id, cursor: share })
        .callTool('submit_result', { summary: 'Located the cause' }),
      { title: '· 定位根因', directory },
    );
    t.fake.enqueue(script().edit('a.txt', 'fixed\n').callTool('submit_result', { summary: 'Fixed' }), {
      title: '· 修复',
      directory,
    });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Looks right' }), {
      agent: 'aw-reviewer',
      directory,
    });
    const review = reaches(task.id, 'review');
    await t.call(startTaskOp, { id: task.id });
    await review;
    await t.fake.settled();

    for (const step of ['· 定位根因', '· 修复']) {
      expect(promptTo(step)).toContain('订单号是 12 位数字');
      expect(promptTo(step)).toContain(`shown="first ${share} of ${ATTACHMENT_PROMPT_MAX_CHARS + 4} characters"`);
    }
    const reviewPrompt = t.fake.prompts.find((p) => p.agent === 'aw-reviewer')?.text;
    expect(reviewPrompt).toContain('订单号是 12 位数字');
    expect(toolResult('read_attachment')).toMatchObject({
      isError: false,
      result: { attachment_id: log.id, total_chars: ATTACHMENT_PROMPT_MAX_CHARS + 4, next_cursor: null },
    });
    expect(JSON.stringify(toolResult('read_attachment')?.result)).toContain('TAIL"');

    const feedback = await uploaded('搜索框在窄窗口被挤出\n', 'feedback.md');
    t.fake.enqueue(
      script()
        .callTool('read_attachment', { attachment_id: unrelated.id })
        .callTool('submit_result', { summary: 'Done' }),
      { title: '· 按反馈修改', directory },
    );
    const again = reaches(task.id, 'review');
    await t.call(requestChangesOp, {
      id: task.id,
      reason: 'user',
      feedback: 'Keep the box visible',
      attachmentIds: [feedback.id],
    });
    await again;
    await t.fake.settled();

    expect(promptTo('· 按反馈修改')).toContain('搜索框在窄窗口被挤出');
    expect(promptTo('· 按反馈修改')).toContain('订单号是 12 位数字');
    expect(toolResult('read_attachment', 1)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.AttachmentNotFound },
    });
  });

  it('Excel 附件在提示词里是概览；read_sheet 与 query_sheet 只读本任务的 Excel 附件', async () => {
    const { project } = await addProject(t);
    const sales = await uploaded(await salesXlsx(), '销售.xlsx');
    const notes = await uploaded('按区域汇总\n', 'notes.md');
    const unrelated = await uploaded(await salesXlsx(), '别的.xlsx');
    const { body: task } = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: 'Total the sales by region',
      start: false,
      attachmentIds: [sales.id, notes.id],
    });
    const directory = `/${task.key}`;
    t.fake.enqueue(
      script()
        .callTool('read_sheet', { attachment_id: sales.id, sheet: '汇总', range: 'A3:B4', include_formulas: true })
        .callTool('query_sheet', { attachment_id: sales.id, ...byRegion })
        .callTool('query_sheet', { attachment_id: unrelated.id, ...byRegion })
        .callTool('read_sheet', { attachment_id: notes.id, sheet: '明细' })
        .callTool('submit_result', { summary: 'Totalled' }),
      { title: '· 定位根因', directory },
    );
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Done' }), { title: '· 修复', directory });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Right' }), {
      agent: 'aw-reviewer',
      directory,
    });
    const review = reaches(task.id, 'review');
    await t.call(startTaskOp, { id: task.id });
    await review;
    await t.fake.settled();

    const prompt = promptTo('· 定位根因');
    expect(prompt).toContain(
      `<attachment attachment_id="${sales.id}" name="销售.xlsx" source="upload" format="xlsx" sheets="3">`,
    );
    expect(prompt).toContain('## 工作表「汇总」（A1:B7，7 行 × 2 列）');
    expect(prompt).toContain('`agent-workflow_read_sheet`');
    expect(prompt).toContain('`agent-workflow_query_sheet`');
    expect(toolResult('read_sheet')).toMatchObject({
      isError: false,
      result: {
        range: 'A3:B4',
        rows: [
          { row: 3, values: ['华东', 1384], formulas: { B: 'SUMIF(明细!B2:B6,A3,明细!F2:F6)' } },
          { row: 4, values: ['华北', 707.5] },
        ],
        next_range: null,
      },
    });
    expect(toolResult('query_sheet')).toMatchObject({
      isError: false,
      result: {
        columns: ['区域', 'sum(金额)'],
        rows: [
          ['华东', 1384],
          ['华北', 707.5],
          ['华南', 700],
        ],
      },
    });
    expect(toolResult('query_sheet', 1)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.AttachmentNotFound },
    });
    expect(toolResult('read_sheet', 1)).toMatchObject({ isError: true, result: { code: ErrorCode.ValidationFailed } });
  });

  it('附件不存在时任务不创建', async () => {
    const { project } = await addProject(t);
    const res = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, 'bugfix'),
      requirement: 'Fix it',
      attachmentIds: ['missing'],
    });
    expect([res.status, res.raw.json().error.code]).toEqual([404, ErrorCode.AttachmentNotFound]);
    expect((await t.call(listTasksOp, {})).body.items).toEqual([]);
  });
});

describe('助手消息的附件（30 §5）', () => {
  async function say(id: string, text: string, attachmentIds?: string[]) {
    const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
    const res = await t.call(sendAssistantMessageOp, {
      id,
      text,
      context: HOME,
      ...(attachmentIds === undefined ? {} : { attachmentIds }),
    });
    await idle;
    return res;
  }

  it('消息带上附件内容并记在消息流里；助手只能读本对话的附件；删除对话后附件随清理删除', async () => {
    const { body: mine } = await t.call(createConversationOp, {});
    const { body: other } = await t.call(createConversationOp, {});
    const spec = await uploaded('导出按钮放在右上角\n', 'spec.md');

    t.fake.enqueue(script().callAppTool('read_attachment', { attachment_id: spec.id }).text('好的'), {
      agent: OPENCODE_ASSISTANT_AGENT,
    });
    await say(mine.id, '看看这个需求', [spec.id]);
    t.fake.enqueue(script().callAppTool('read_attachment', { attachment_id: spec.id }).text('看不到'), {
      agent: OPENCODE_ASSISTANT_AGENT,
    });
    await say(other.id, '读一下 spec.md');

    expect(t.fake.prompts.find((p) => p.text.includes('看看这个需求'))?.text).toContain('导出按钮放在右上角');
    const page: TranscriptPage = (
      await t.request({ method: 'GET', url: `/assistant/conversations/${mine.id}/transcript` })
    ).json();
    expect(page.entries.find((e) => e.kind === 'user_message')?.data).toEqual({
      text: '看看这个需求',
      attachments: [{ id: spec.id, name: 'spec.md' }],
    });
    expect(toolResult('read_attachment', 0)).toMatchObject({ isError: false, result: { name: 'spec.md' } });
    expect(toolResult('read_attachment', 1)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.AttachmentNotFound },
    });

    const sales = await uploaded(await salesXlsx(), '销售.xlsx');
    t.fake.enqueue(
      script()
        .callAppTool('query_sheet', { attachment_id: sales.id, ...byRegion })
        .text('华东最多'),
      {
        agent: OPENCODE_ASSISTANT_AGENT,
      },
    );
    await say(mine.id, '哪个区域卖得最多', [sales.id]);
    t.fake.enqueue(script().callAppTool('read_sheet', { attachment_id: sales.id, sheet: '明细' }).text('看不到'), {
      agent: OPENCODE_ASSISTANT_AGENT,
    });
    await say(other.id, '读一下销售表');
    expect(t.fake.prompts.find((p) => p.text.includes('哪个区域卖得最多'))?.text).toContain(
      '`agent-workflow-app_query_sheet`',
    );
    expect(toolResult('query_sheet')).toMatchObject({
      isError: false,
      result: {
        rows: [
          ['华东', 1384],
          ['华北', 707.5],
          ['华南', 700],
        ],
      },
    });
    expect(toolResult('read_sheet')).toMatchObject({ isError: true, result: { code: ErrorCode.AttachmentNotFound } });

    await t.call(deleteConversationOp, { id: mine.id });
    clock.advance(ATTACHMENT_ORPHAN_TTL_MS + 1);
    await t.app.services.attachments.cleanup();
    expect((await t.call(getAttachmentOp, { id: spec.id })).status).toBe(404);
  });
});
