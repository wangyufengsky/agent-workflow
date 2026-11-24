import {
  createConversationOp,
  createDbConnectionOp,
  databaseInvestigationSchema,
  listDatabaseInvestigationsOp,
  MCP_ASSISTANT_TOOL_PREFIX,
  McpToolName,
  ServerEventType,
  sendAssistantMessageOp,
  setProjectDbConnectionsOp,
  type TranscriptPage,
  updateSettingsOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestApp } from '../packages/server/test/helpers/app.ts';
import { testCipher } from '../packages/server/test/helpers/cipher.ts';
import { startMysql } from '../packages/server/test/helpers/db-containers.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';
import { addProject } from '../packages/server/test/helpers/tasks.ts';

it('@live 项目助手在单槽下委派实际查询，追问沿用调查', async () => {
  const db = await startMysql();
  try {
    await db.exec(
      'CREATE TABLE sales (city VARCHAR(40), amount INT); INSERT INTO sales VALUES ("上海",35),("上海",47),("成都",13)',
    );
    const t = await createTestApp({ realOpencode: true, cipher: testCipher });
    try {
      await t.app.start(t.port);
      await t.call(updateSettingsOp, {
        'ai.defaultModel': TEST_MODEL,
        'ui.mode': 'pro',
        'scheduler.maxConcurrentAttempts': 1,
      });
      const { project } = await addProject(t);
      const { body: source } = await t.call(createDbConnectionOp, {
        type: 'mysql',
        name: 'sales-fixture',
        host: db.host,
        port: db.port,
        database: db.database,
        username: db.username,
        password: db.password,
        tlsMode: 'off',
      });
      await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [source.id] });
      const { body: conversation } = await t.call(createConversationOp, { projectId: project.id });
      async function ask(text: string) {
        const idle = waitForEvent(
          t.app.events,
          ServerEventType.AssistantUpdated,
          (c) => c.id === conversation.id && !c.busy,
          180_000,
        );
        expect(
          (
            await t.call(sendAssistantMessageOp, {
              id: conversation.id,
              text,
              context: { page: 'project', params: { projectId: project.id } },
            })
          ).status,
        ).toBe(200);
        await idle;
        return (await t.call(listDatabaseInvestigationsOp, { kind: 'assistant', id: conversation.id })).body.items;
      }
      const first = await ask(
        '请委托数据库分析员调查项目关联的 sales-fixture。查 sales 的结构，然后查每个城市的销售总额，告诉我上海的总额和依据。',
      );
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        status: 'completed',
        answer: expect.stringContaining('82'),
        evidence: expect.arrayContaining([expect.objectContaining({ kind: 'query' })]),
      });
      const next = await ask('请同一位数据库分析员继续刚才的调查，对成都也核实一次，告诉我总额。');
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({
        investigationId: first[0]?.investigationId,
        status: 'completed',
        answer: expect.stringContaining('13'),
      });
      expect(next[0]?.turns).toHaveLength(2);
      const transcript: TranscriptPage = (
        await t.request({
          method: 'GET',
          url: `/assistant/conversations/${conversation.id}/transcript`,
        })
      ).json();
      const evidence = transcript.entries.flatMap((entry) => {
        if (
          entry.kind !== 'tool_result' ||
          entry.data.tool !== MCP_ASSISTANT_TOOL_PREFIX + McpToolName.InvestigateDatabase ||
          !entry.data.output
        )
          return [];
        return [databaseInvestigationSchema.parse(JSON.parse(entry.data.output))];
      });
      expect(evidence.map((item) => item.investigationId)).toEqual([
        first[0]?.investigationId,
        first[0]?.investigationId,
      ]);
      expect(
        transcript.entries.flatMap((entry) => (entry.kind === 'text' ? [entry.data.text] : [])).join(' '),
      ).toContain('13');
    } finally {
      await t.close();
    }
  } finally {
    await db.stop();
  }
}, 420_000);
