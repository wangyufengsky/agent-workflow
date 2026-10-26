import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AssistantPageRef,
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  createConversationOp,
  ErrorCode,
  listAssistantFilesOp,
  OPENCODE_ASSISTANT_AGENT,
  previewAssistantFileOp,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptPage,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';

const HOME: AssistantPageRef = { page: 'home', params: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function uploaded(content: Buffer, name: string): Promise<AttachmentDTO> {
  const res = await t.request({
    method: 'POST',
    url: '/attachments',
    headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: encodeURIComponent(name) },
    payload: content,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function say(id: string, text: string, attachmentIds?: string[]) {
  const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === id && !c.busy);
  await t.call(sendAssistantMessageOp, {
    id,
    text,
    context: HOME,
    ...(attachmentIds === undefined ? {} : { attachmentIds }),
  });
  await idle;
}

const toolResults = (name: string) => t.fake.toolCalls.filter((c) => c.name === name);
const salesXlsx = () => readFile(new URL('../../../test/fixtures/office/sales.libreoffice.xlsx', import.meta.url));
const byRegion = {
  sheet: '明细',
  group_by: ['区域'],
  aggregates: [{ fn: 'sum', column: '金额' }],
  order_by: [{ column: 'sum(金额)', desc: true }],
};

describe('助手生成 Word 与 Excel（39 §7.2）', () => {
  it('写进对话目录并在消息流里出现文件卡片；重名加序号；rows_from 只能用本对话的附件；预览与下载读同一个文件', async () => {
    const { body: mine } = await t.call(createConversationOp, {});
    const { body: other } = await t.call(createConversationOp, {});
    const sales = await uploaded(await salesXlsx(), '销售.xlsx');
    const report = {
      file: 'out/周报.docx',
      blocks: [
        { type: 'heading', level: 1, text: '九月销售' },
        { type: 'table', header: ['区域', '金额'], rows: [['华东', '1384']] },
      ],
    };
    const totals = {
      file: '按区域.xlsx',
      sheets: [{ name: '按区域', rows_from: { attachment_id: sales.id, ...byRegion } }],
    };
    t.fake.enqueue(
      script()
        .callAppTool('create_docx', report)
        .callAppTool('create_docx', report)
        .callAppTool('create_xlsx', totals)
        .callAppTool('create_docx', { ...report, file: '../逃出去.docx' })
        .text('做好了'),
      { agent: OPENCODE_ASSISTANT_AGENT },
    );
    await say(mine.id, '按区域汇总并写一份周报', [sales.id]);
    t.fake.enqueue(script().callAppTool('create_xlsx', totals).text('不行'), { agent: OPENCODE_ASSISTANT_AGENT });
    await say(other.id, '用那份销售表');

    const docx = toolResults('create_docx');
    expect(docx.map((c) => c.result)).toMatchObject([
      { file: 'out/周报.docx' },
      { file: 'out/周报 (2).docx' },
      { code: ErrorCode.ValidationFailed },
    ]);
    const xlsx = toolResults('create_xlsx');
    expect(xlsx[0]).toMatchObject({ isError: false, result: { file: '按区域.xlsx' } });
    expect(xlsx[1]).toMatchObject({ isError: true, result: { code: ErrorCode.AttachmentNotFound } });

    const files = (await t.call(listAssistantFilesOp, { id: mine.id })).body.items.map((f) => f.path);
    expect(files).toEqual(['out/周报 (2).docx', 'out/周报.docx', '按区域.xlsx']);
    const page: TranscriptPage = (
      await t.request({ method: 'GET', url: `/assistant/conversations/${mine.id}/transcript` })
    ).json();
    expect(page.entries.filter((e) => e.kind === 'attachment').map((e) => e.data)).toEqual([
      { path: 'out/周报.docx' },
      { path: 'out/周报 (2).docx' },
      { path: '按区域.xlsx' },
    ]);

    expect((await t.call(previewAssistantFileOp, { id: mine.id, path: 'out/周报.docx' })).body).toMatchObject({
      format: 'docx',
      meta: { headings: 1, tables: 1 },
      markdown: expect.stringContaining('# 九月销售'),
    });
    expect((await t.call(previewAssistantFileOp, { id: mine.id, path: '按区域.xlsx' })).body).toMatchObject({
      format: 'xlsx',
      sheet: {
        name: '按区域',
        rows: [
          { cells: [{ v: '区域' }, { v: 'sum(金额)' }] },
          { cells: [{ v: '华东' }, { v: 1384 }] },
          { cells: [{ v: '华北' }, { v: 707.5 }] },
          { cells: [{ v: '华南' }, { v: 700 }] },
        ],
      },
    });
    const raw = await t.request({
      method: 'GET',
      url: `/assistant/conversations/${mine.id}/files/raw?path=${encodeURIComponent('按区域.xlsx')}`,
    });
    expect(raw.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('按区域.xlsx')}`,
    );
    expect(raw.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const outside = await t.request({
      method: 'GET',
      url: `/assistant/conversations/${mine.id}/files/raw?path=${encodeURIComponent('../../app.db')}`,
    });
    expect([outside.statusCode, outside.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);
  });

  it('对话目录里指向外面的符号链接不能把文件写出去，也不能借它下载外面的文件', async () => {
    const { body: c } = await t.call(createConversationOp, {});
    const outside = join(tmpdir(), `aw-outside-${c.id}`);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'secret\n');
    const dir = t.app.services.assistant.filesDir(c.id);
    await mkdir(dir, { recursive: true });
    await symlink(outside, join(dir, 'linked'));
    const report = { file: 'linked/report.docx', blocks: [{ type: 'paragraph', text: '出去' }] };
    t.fake.enqueue(script().callAppTool('create_docx', report).text('不行'), { agent: OPENCODE_ASSISTANT_AGENT });
    await say(c.id, '写一份');

    expect(toolResults('create_docx')[0]).toMatchObject({
      isError: true,
      result: { code: ErrorCode.ValidationFailed },
    });
    expect(await readdir(outside)).toEqual(['secret.txt']);
    const raw = await t.request({
      method: 'GET',
      url: `/assistant/conversations/${c.id}/files/raw?path=${encodeURIComponent('linked/secret.txt')}`,
    });
    expect([raw.statusCode, raw.json().error.code]).toEqual([400, ErrorCode.ValidationFailed]);
  });

  it('修改与改写：源可以是本对话的附件或写过的文件，另存新文件、原件不变；丢失的内容随卡片记下；格式不对或别的对话的附件被拒', async () => {
    const { body: mine } = await t.call(createConversationOp, {});
    const { body: other } = await t.call(createConversationOp, {});
    const sales = await uploaded(await salesXlsx(), '销售.xlsx');
    const word = await uploaded(
      await readFile(new URL('../../../test/fixtures/office/report.libreoffice.docx', import.meta.url)),
      '需求.docx',
    );
    const edit = {
      source: { attachment_id: sales.id },
      file: '销售（加备注）.xlsx',
      operations: [
        { op: 'insert_rows', sheet: '汇总', before: 2, count: 1 },
        { op: 'set_cells', sheet: '明细', start: 'G1', values: [['备注']] },
      ],
    };
    const revise = {
      source: { attachment_id: word.id },
      file: '需求（修订）.docx',
      blocks: [{ type: 'heading', level: 1, text: '订单导出需求（修订）' }],
    };
    t.fake.enqueue(
      script()
        .callAppTool('edit_xlsx', edit)
        .callAppTool('revise_docx', revise)
        .callAppTool('revise_docx', { ...revise, source: { file: '需求（修订）.docx' }, file: '再改一次.docx' })
        .callAppTool('edit_xlsx', { ...edit, source: { attachment_id: word.id } })
        .text('改好了'),
      { agent: OPENCODE_ASSISTANT_AGENT },
    );
    await say(mine.id, '在销售表上加备注列，再修订需求文档', [sales.id, word.id]);
    t.fake.enqueue(script().callAppTool('edit_xlsx', edit).text('不行'), { agent: OPENCODE_ASSISTANT_AGENT });
    await say(other.id, '改那份销售表');

    expect(toolResults('edit_xlsx').map((c) => c.result)).toMatchObject([
      { file: '销售（加备注）.xlsx', lost: [{ kind: 'formula_references', count: 9 }] },
      { code: ErrorCode.ValidationFailed },
      { code: ErrorCode.AttachmentNotFound },
    ]);
    expect(toolResults('revise_docx').map((c) => c.result)).toMatchObject([
      { file: '需求（修订）.docx', lost: [{ kind: 'images', count: 1 }] },
      { file: '再改一次.docx', lost: [] },
    ]);
    const page: TranscriptPage = (
      await t.request({ method: 'GET', url: `/assistant/conversations/${mine.id}/transcript` })
    ).json();
    expect(page.entries.filter((e) => e.kind === 'attachment').map((e) => e.data)).toEqual([
      { path: '销售（加备注）.xlsx', lost: [{ kind: 'formula_references', count: 9 }] },
      { path: '需求（修订）.docx', lost: [{ kind: 'images', count: 1 }] },
      { path: '再改一次.docx' },
    ]);
    const edited = (await t.call(previewAssistantFileOp, { id: mine.id, path: '销售（加备注）.xlsx', sheet: '明细' }))
      .body;
    expect(edited.format === 'xlsx' && edited.sheet.rows[0]?.cells.at(-1)).toEqual({ c: 7, v: '备注' });
    // The attachment itself is untouched.
    expect((await readFile(t.app.services.attachments.originalPath(sales.id))).equals(await salesXlsx())).toBe(true);
  });
});
