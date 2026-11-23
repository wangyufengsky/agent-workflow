import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ATTACHMENT_NAME_HEADER,
  attachmentSchema,
  createConversationOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_TOOL_PREFIX,
  McpToolName,
  ServerEventType,
  sendAssistantMessageOp,
  TaskStatus,
  type TranscriptEntry,
  type TranscriptPage,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

const TURN_TIMEOUT_MS = 4 * 60_000;

it(
  '@live 助手和任务评审员都可以请文档处理员提取附件中的条款',
  async () => {
    const live = await startLiveApp('document-processing');
    const { t } = live;
    try {
      const clause = `DOC-${randomBytes(3).toString('hex').toUpperCase()}`;
      const uploaded = await t.request({
        method: 'POST',
        url: '/attachments',
        headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: 'service.md' },
        payload: Buffer.from(`# 服务约定\n\n## 恢复规则\n\n重开任务前应记录条款编号 ${clause}。\n`),
      });
      expect(uploaded.statusCode).toBe(201);
      const doc = attachmentSchema.parse(uploaded.json());
      const { body: conversation } = await t.call(createConversationOp, {});
      const idle = waitForEvent(
        t.app.events,
        ServerEventType.AssistantUpdated,
        (item) => item.id === conversation.id && !item.busy,
        TURN_TIMEOUT_MS,
      );
      const sent = await t.call(sendAssistantMessageOp, {
        id: conversation.id,
        text: '请让文档处理员用附件的原文读取服务约定，按原样给出「恢复规则」中的条款编号。',
        context: { page: 'home', params: {} },
        attachmentIds: [doc.id],
      });
      expect(sent.status).toBe(200);
      await idle;
      const transcript: TranscriptPage = (
        await t.request({
          method: 'GET',
          url: `/assistant/conversations/${conversation.id}/transcript`,
        })
      ).json();
      expect(transcript.entries).toContainEqual(
        expect.objectContaining({
          kind: 'tool_result',
          data: expect.objectContaining({
            tool: `${MCP_ASSISTANT_TOOL_PREFIX}${McpToolName.ProcessDocument}`,
            status: 'completed',
          }),
        }),
      );
      expect(
        transcript.entries.flatMap((entry) => (entry.kind === 'text' ? [entry.data.text] : [])).join('\n'),
      ).toContain(clause);

      const task = await live.runTask(
        'design_proposal',
        'ts-stats',
        '给出重开任务的方案。先用 process_document 把附件《服务约定》的恢复规则交给文档处理员提取，再在方案中引用得到的条款编号。',
        { attachmentIds: [doc.id] },
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      expect(task.result?.summary).toContain(clause);
      const dir = join(t.dataDir, 'runs', task.id);
      const transcripts = await Promise.all(
        (await readdir(dir)).filter((file) => file.endsWith('.jsonl')).map((file) => readFile(join(dir, file), 'utf8')),
      );
      const entries: TranscriptEntry[] = transcripts.flatMap((text) =>
        text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      );
      expect(entries).toContainEqual(
        expect.objectContaining({
          kind: 'tool_result',
          data: expect.objectContaining({
            tool: `${MCP_TOOL_PREFIX}${McpToolName.ProcessDocument}`,
            status: 'completed',
          }),
        }),
      );
    } finally {
      await live.close();
    }
  },
  TASK_TIMEOUT_MS,
);
