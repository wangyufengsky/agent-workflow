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
  getModelSlotsOp,
  IMAGE_ANALYSIS_CLEANUP_TIMEOUT_MS,
  IMAGE_ANALYSIS_TIMEOUT_MS,
  listTasksOp,
  OPENCODE_ASSISTANT_AGENT,
  OPENCODE_IMAGE_AGENT,
  requestChangesOp,
  ServerEventType,
  sendAssistantMessageOp,
  startTaskOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { WHITE_PNG_BASE64 } from '../../../test/fixtures/white-png.ts';
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

  it('助手委派文档处理员修订已绑定的原文，保留附件并隔离其他对话', async () => {
    const attachment = await uploaded('验收：刷新后保持已完成', 'cases.md');
    const mine = (await t.call(createConversationOp, {})).body;
    const other = (await t.call(createConversationOp, {})).body;
    const api = vi.spyOn(t.fake, 'promptDocument').mockResolvedValue('刷新后，原事项仍应显示已完成。');
    const input = { instruction: '把验收写成一句话', source: { attachment_id: attachment.id } };
    const delegate = () =>
      t.fake.enqueue(script().callAppTool('process_document', input), { agent: OPENCODE_ASSISTANT_AGENT });
    delegate();
    await say(mine.id, '修订这条用例', [attachment.id]);
    expect(toolResult('process_document')).toMatchObject({
      isError: false,
      result: { text: '刷新后，原事项仍应显示已完成。', next_cursor: null },
    });
    expect(api.mock.calls[0]?.[0].text).toContain('验收：刷新后保持已完成');
    delegate();
    await say(other.id, '处理上一个对话的附件');
    expect(toolResult('process_document', 1)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.AttachmentNotFound },
    });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('助手从当前对话委派 PNG 给单独配置的模型，其他对话不能读图', async () => {
    const model = { providerId: 'local', modelId: 'vision' };
    t.fake.models.push({ ...model, name: 'Vision', contextLimit: null, supportsImage: true });
    const png = Buffer.from(WHITE_PNG_BASE64, 'base64');
    const image = await uploaded(png, '错误截图.png');
    expect(image.format).toBe('png');
    const content = await t.request({ method: 'GET', url: `/attachments/${image.id}/content` });
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.rawPayload).toEqual(png);

    const { body: mine } = await t.call(createConversationOp, {});
    const { body: other } = await t.call(createConversationOp, {});
    const input = { source: { attachment_id: image.id }, question: '图里是什么颜色？' };
    const delegate = () =>
      t.fake.enqueue(script().callAppTool('analyze_image', input), { agent: OPENCODE_ASSISTANT_AGENT });
    const readImage = vi.spyOn(t.fake, 'promptImage').mockResolvedValue('白色');
    delegate();
    await say(mine.id, '请读图', [image.id]);
    expect(toolResult('analyze_image', 0)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.ImageAnalysisUnavailable },
    });

    expect((await t.call(updateSettingsOp, { 'ai.imageModel': 'local/vision' })).status).toBe(200);
    delegate();
    await say(other.id, '请读图');
    expect(toolResult('analyze_image', 1)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.AttachmentNotFound },
    });
    delegate();
    await say(mine.id, '再读一下这张图');
    expect(toolResult('analyze_image', 2)).toMatchObject({
      isError: false,
      result: { source: { attachment_id: image.id, name: '错误截图.png' }, analysis: '白色' },
    });
    expect(readImage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        model,
        question: input.question,
        image: { mime: 'image/png', data: png },
      }),
    );
    expect(t.fake.sessions.some((s) => s.agent === OPENCODE_IMAGE_AGENT)).toBe(false);
    const prompt = t.fake.prompts.find((p) => p.text.includes('aw-image-analysis'))?.text;
    expect(prompt).toContain(`attachment_id="${image.id}"`);
    expect(prompt).not.toContain(png.toString('base64'));
  });

  it.each([
    { scenario: '正常清理', stalled: null },
    { scenario: '中止请求无响应', stalled: 'abort' },
    { scenario: '删除请求无响应', stalled: 'deleteSession' },
  ] as const)('图像处理员超时后归还并发名额（$scenario）', async ({ stalled }) => {
    t.fake.models.push({
      providerId: 'local',
      modelId: 'vision',
      name: 'Vision',
      contextLimit: null,
      supportsImage: true,
    });
    await t.call(updateSettingsOp, { 'ai.imageModel': 'local/vision' });
    const image = await uploaded(Buffer.from(WHITE_PNG_BASE64, 'base64'), 'screen.png');
    const { body: conversation } = await t.call(createConversationOp, {});
    const started = Promise.withResolvers<string>();
    vi.spyOn(t.fake, 'promptImage').mockImplementation(({ sessionId, signal }) => {
      started.resolve(sessionId);
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const cleaning = Promise.withResolvers<void>();
    if (stalled !== null) {
      vi.spyOn(t.fake, stalled).mockImplementation(({ signal }) => {
        cleaning.resolve();
        return new Promise((_, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      });
    }
    t.fake.enqueue(
      script().callAppTool('analyze_image', {
        source: { attachment_id: image.id },
        question: 'What is visible?',
      }),
      { agent: OPENCODE_ASSISTANT_AGENT },
    );

    const result = say(conversation.id, '请读图', [image.id]);
    const reader = await started.promise;
    expect((await t.call(getModelSlotsOp, {})).body.inUse).toBe(2);
    clock.advance(IMAGE_ANALYSIS_TIMEOUT_MS);
    if (stalled !== null) {
      await cleaning.promise;
      clock.advance(IMAGE_ANALYSIS_CLEANUP_TIMEOUT_MS);
    }
    await result;
    expect(toolResult('analyze_image')).toMatchObject({
      isError: true,
      result: { code: ErrorCode.ImageAnalysisFailed, message: 'Image analysis timed out' },
    });
    if (stalled === null) {
      expect(t.fake.aborts).toContain(reader);
      expect(t.fake.sessions.some((s) => s.id === reader)).toBe(false);
    }
    expect((await t.call(getModelSlotsOp, {})).body.inUse).toBe(0);
  });

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
