import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AttemptKind,
  createConversationOp,
  deleteConversationOp,
  getAssistantContextOp,
  getAttemptContextOp,
  MCP_SESSION_ARG,
  OPENCODE_APPROVER_AGENT,
  OPENCODE_COMPANION_AGENT,
  OPENCODE_DATABASE_INVESTIGATOR_AGENT,
  OPENCODE_DOCUMENT_AGENT,
  OPENCODE_IMAGE_AGENT,
  ServerEventType,
  SessionAgent,
  sendAssistantMessageOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE } from '../../core/db/database.ts';
import { SessionPurpose } from './opencode.dispatch.ts';
import { OpencodeEventType } from './opencode.events.ts';

const model = 'opencode/fake-model';
const budget = {
  before: 1600,
  after: 800,
  limit: 1000,
  model,
  systemTokens: 100,
  toolTokens: 100,
  dialogueTokens: 200,
  toolOutputTokens: 400,
  summaryTokens: 0,
  mediaTokens: 0,
  externalTokens: 0,
  outputReserve: 100,
  bytesPerToken: 3,
  calibrated: false,
  cacheRead: 0,
  overBudgetWarning: false,
  receipt: {
    sent: ['latest'],
    folded: ['prt_source'],
    protected: ['latest'],
    summarized: [],
    anchor: null,
    summaryText: null,
  },
};
function scope(t: TestApp, directory: string, sessionId?: string) {
  return t.app.server
    .inject({
      url: '/internal/context/scope',
      query: { directory, ...(sessionId && { sessionId }) },
      headers: { authorization: `Bearer ${t.app.mcpToken}` },
    })
    .then((r) => r.json());
}
it.each(['attempt', 'assistant'] as const)(
  '%s 在自己的物理会话回查原文，发布摘要后抽屉仍读取同一归属',
  async (kind) => {
    const t = await createTestApp();
    const db = new DatabaseSync(join(t.dataDir, DATABASE_FILE), { readOnly: true });
    const done = Promise.withResolvers<{ error: undefined }>();
    const worker = Promise.withResolvers<{ sessionId: string; signal: AbortSignal }>();
    const release = Promise.withResolvers<string>();
    const mcp = await connectMcp(
      kind === 'attempt' ? t.mcpUrl : t.assistantMcpUrl,
      kind === 'attempt' ? t.app.mcpToken : t.app.assistantMcpToken,
    );
    try {
      let ownerId: string, sessionId: string, directory: string;
      if (kind === 'attempt') {
        const { project } = await addProject(t);
        t.fake.enqueue(script().hang());
        const attempt = await t.app.services.attempts.start({
          kind: AttemptKind.Research,
          agent: SessionAgent.Researcher,
          title: 'Research',
          prompt: 'Find evidence',
          model,
          taskId: null,
          nodeId: null,
          projectId: project.id,
          roleId: null,
          directory: project.repoPath,
        });
        if (!attempt.opencodeSessionId) throw Error('Missing research session');
        ownerId = attempt.id;
        sessionId = attempt.opencodeSessionId;
        directory = attempt.directory;
      } else {
        const { body: c } = await t.call(createConversationOp, {});
        t.fake.promptAssistant = () => ({
          accepted: Promise.resolve(),
          started: Promise.resolve(),
          isRunning: async () => true,
          completed: done.promise,
        });
        expect(
          (
            await t.call(sendAssistantMessageOp, {
              id: c.id,
              text: 'Find evidence',
              context: { page: 'home', params: {} },
            })
          ).status,
        ).toBe(200);
        ownerId = c.id;
        const source = t.app.services.assistant.contextSource(c.id);
        if (!source.sessionId) throw Error('Missing assistant session');
        sessionId = source.sessionId;
        directory = source.directory;
      }
      const recallTool = kind === 'attempt' ? 'agent-workflow_recall' : 'agent-workflow-app_recall';
      expect(await scope(t, directory)).toEqual({ enabled: true });
      expect(await scope(t, directory, sessionId)).toMatchObject({
        enabled: true,
        ownerId,
        kind,
        recallTool,
        toolBytes: expect.any(Number),
      });
      expect(await scope(t, t.dataDir, sessionId)).toMatchObject({ enabled: false, ownerId: null });
      t.fake.replay([
        {
          type: OpencodeEventType.Tool,
          sessionId,
          messageId: 'msg_source',
          partId: 'prt_source',
          callId: 'call_read',
          tool: 'read',
          input: {},
          status: 'completed',
          output: 'first evidence',
        },
      ]);
      expect(
        (
          await callTool(mcp, 'recall', {
            [MCP_SESSION_ARG]: sessionId,
            messageId: 'msg_source',
            partId: 'prt_source',
            offset: 6,
            limit: 3,
          })
        ).body,
      ).toMatchObject({ content: 'evi', nextOffset: 9 });
      t.fake.promptDocument = async (input) => {
        expect(input.system).toContain(recallTool);
        if (!input.signal) throw Error('Missing worker signal');
        worker.resolve({ sessionId: input.sessionId, signal: input.signal });
        return release.promise;
      };
      const report = await t.app.server.inject({
        method: 'POST',
        url: '/internal/context/budget',
        headers: { authorization: `Bearer ${t.app.mcpToken}` },
        payload: {
          ...budget,
          ownerId,
          sessionId,
          directory,
          summary: { model, source: 'closed evidence '.repeat(100), uptoMessageId: 'msg_source' },
        },
      });
      expect(report.json()).toEqual({ blocked: false });
      const running = await worker.promise;
      if (kind === 'assistant') {
        const idle = waitForEvent(t.app.events, ServerEventType.AssistantUpdated, (c) => c.id === ownerId && !c.busy);
        done.resolve({ error: undefined });
        await idle;
        expect(running.signal.aborted).toBe(false);
      }
      const closed = Promise.withResolvers<void>();
      const unsubscribe = t.fake.subscribe((e) => {
        if (e.type === OpencodeEventType.Deleted && e.sessionId === running.sessionId) closed.resolve();
      });
      release.resolve('summary evidence');
      await closed.promise;
      unsubscribe();
      const row = () =>
        db
          .prepare('SELECT task_id,attempt_id,conversation_id FROM context_summaries WHERE session_id=?')
          .get(sessionId);
      expect(row()).toEqual({
        task_id: null,
        attempt_id: kind === 'attempt' ? ownerId : null,
        conversation_id: kind === 'assistant' ? ownerId : null,
      });
      const detail =
        kind === 'attempt'
          ? await t.call(getAttemptContextOp, { id: ownerId })
          : await t.call(getAssistantContextOp, { id: ownerId });
      expect(detail.body).toMatchObject({
        managed: true,
        reconstructed: false,
        budget: { after: 800 },
        summary: { summaryText: 'summary evidence' },
      });
      if (kind === 'assistant') {
        expect((await t.call(deleteConversationOp, { id: ownerId })).status).toBe(204);
        expect(row()).toBeUndefined();
      } else {
        const attempts = t.app.services.attempts;
        await attempts.abort(ownerId);
        t.fake.enqueue(script().hang());
        const next = await attempts.dispatchObjectAttempt({
          purpose: SessionPurpose.Knowledge,
          previousId: ownerId,
          first: () => {
            throw new Error('Expected the research session to be reused');
          },
          followUp: () => ({ agent: SessionAgent.Researcher, system: undefined, prompt: 'Follow up' }),
        });
        expect(next.id).not.toBe(ownerId);
        expect(next.opencodeSessionId).toBe(sessionId);
        expect(await scope(t, directory, sessionId)).toMatchObject({ ownerId: next.id, summary: detail.body.summary });
        const followUp = await t.call(getAttemptContextOp, { id: next.id });
        expect(followUp.body.summary).toEqual(detail.body.summary);
        expect(followUp.body.budget).toBeNull();
        await attempts.abort(next.id);
      }
    } finally {
      done.resolve({ error: undefined });
      release.resolve('released');
      await mcp.close();
      db.close();
      await t.close();
    }
  },
);

it('内部会话没有投影归属，Companion 共用项目目录时也直接透传', async () => {
  const t = await createTestApp();
  try {
    const { project } = await addProject(t);
    for (const [purpose, agent] of [
      ['Approval', OPENCODE_APPROVER_AGENT],
      ['Document', OPENCODE_DOCUMENT_AGENT],
      ['Image', OPENCODE_IMAGE_AGENT],
      ['Companion', OPENCODE_COMPANION_AGENT],
      ['ContextSummary', OPENCODE_DOCUMENT_AGENT],
      ['DatabaseInvestigation', OPENCODE_DATABASE_INVESTIGATOR_AGENT],
    ] as const) {
      const shared = purpose === 'Companion';
      const directory = shared ? project.repoPath : join(t.dataDir, purpose);
      const sessionId = await t.fake.createSession({ directory, title: purpose, agent, permission: [] });
      expect(await scope(t, directory)).toEqual({ enabled: shared });
      expect(await scope(t, directory, sessionId)).toEqual({ enabled: false, ownerId: null });
    }
  } finally {
    await t.close();
  }
});
