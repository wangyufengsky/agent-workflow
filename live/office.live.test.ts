import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ASSISTANT_CONVERSATIONS_DIR,
  ASSISTANT_DIR,
  ASSISTANT_FILES_DIR,
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  createConversationOp,
  createXlsxInputSchema,
  getRuntimeOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  ServerEventType,
  sendAssistantMessageOp,
  type TranscriptEntry,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDocx } from '../packages/server/src/modules/office/office.docx.ts';
import { writeXlsx } from '../packages/server/src/modules/office/office.write.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** OF-07 (39 §14): a real model totals an Excel attachment with the sheet tools and writes a Word report. */
const TURN_TIMEOUT_MS = 8 * 60_000;
const REGIONS = ['华东', '华北', '华南'] as const;
const ROWS = 300;

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
}, 60_000);
afterAll(() => t.close());

/**
 * More rows than the prompt's overview shows (its first 10 and last 2), so the totals can only come from the sheet
 * tools. Whole amounts, so the report's numbers are compared without rounding.
 */
async function salesWorkbook(): Promise<{ bytes: Buffer; totals: Record<string, number> }> {
  const totals: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r, 0]));
  const rows = Array.from({ length: ROWS }, (_, i) => {
    const region = REGIONS[(i * 7) % REGIONS.length] as string;
    const amount = 100 + ((i * 37) % 900);
    totals[region] = (totals[region] ?? 0) + amount;
    return [{ date: `2026-09-${String((i % 30) + 1).padStart(2, '0')}` }, region, `P${i % 5}`, amount];
  });
  const { sheets } = createXlsxInputSchema.parse({
    file: '九月销售.xlsx',
    sheets: [
      {
        name: '明细',
        columns: [
          { header: '日期', type: 'date' },
          { header: '区域' },
          { header: '产品' },
          { header: '金额', type: 'number' },
        ],
        rows,
      },
    ],
  });
  return { bytes: await writeXlsx(sheets, async () => undefined), totals };
}

describe('@live Word 与 Excel', () => {
  it('助手用表格工具按区域汇总 Excel 附件，并把结果写成 Word 报告', async () => {
    const { bytes, totals } = await salesWorkbook();
    const res = await t.request({
      method: 'POST',
      url: '/attachments',
      headers: {
        'content-type': 'application/octet-stream',
        [ATTACHMENT_NAME_HEADER]: encodeURIComponent('九月销售.xlsx'),
      },
      payload: bytes,
    });
    expect(res.statusCode).toBe(201);
    const attachment = res.json<AttachmentDTO>();

    const { body: conversation } = await t.call(createConversationOp, {});
    const idle = waitForEvent(
      t.app.events,
      ServerEventType.AssistantUpdated,
      (c) => c.id === conversation.id && !c.busy,
      TURN_TIMEOUT_MS,
    );
    await t.call(sendAssistantMessageOp, {
      id: conversation.id,
      text: '按区域汇总附件里的金额，然后写一份 Word 报告，文件名用「九月销售报告.docx」，报告里列出每个区域的合计金额。',
      context: { page: 'home', params: {} },
      attachmentIds: [attachment.id],
    });
    await idle;

    const transcript = join(t.dataDir, ASSISTANT_DIR, ASSISTANT_CONVERSATIONS_DIR, `${conversation.id}.jsonl`);
    const entries: TranscriptEntry[] = (await readFile(transcript, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const tools = entries.flatMap((e) => (e.kind === 'tool_call' ? [e.data.tool] : []));
    const files = entries.flatMap((e) => (e.kind === 'attachment' ? [e.data.path] : []));
    const errors = entries.filter((e) => e.kind === 'error');
    const report = files.find((path) => path.endsWith('.docx'));
    const text =
      report === undefined
        ? ''
        : (await readDocx(await readFile(join(t.dataDir, ASSISTANT_DIR, ASSISTANT_FILES_DIR, conversation.id, report))))
            .text;
    await mkdir(new URL('reports', import.meta.url), { recursive: true });
    await writeFile(
      new URL(`reports/office-${new Date().toISOString().replaceAll(':', '-')}.json`, import.meta.url),
      JSON.stringify({ model: TEST_MODEL, tools, files, totals, report: text, errors }, null, 2),
    );

    expect(errors).toEqual([]);
    expect(tools.some((tool) => /(query|read)_sheet$/.test(tool))).toBe(true);
    expect(tools).toContain(`${MCP_ASSISTANT_TOOL_PREFIX}create_docx`);
    expect(report).toBeDefined();
    // The model may group digits (12,345) or not.
    const plain = text.replaceAll(',', '').replaceAll('，', '');
    for (const [region, total] of Object.entries(totals)) {
      expect(plain).toContain(region);
      expect(plain).toContain(String(total));
    }
  });
});
