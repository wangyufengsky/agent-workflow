import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  createConversationOp,
  createDbConnectionOp,
  DbType,
  deleteConversationOp,
  ErrorCode,
  OPENCODE_DATABASE_INVESTIGATOR_AGENT,
  setProjectDbConnectionsOp,
  updateDbConnectionOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createFakeOpencode } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { DB_DRIVERS, type DbDriver } from '../databases/index.ts';

it('persists evidence and reuses the same restricted native session after restart, while confining DB access to the linked subject', async () => {
  const source = new DatabaseSync(':memory:');
  source.exec('CREATE TABLE rates (amount INTEGER); INSERT INTO rates VALUES (23), (42);');
  const statements: string[] = [];
  const driver: DbDriver = {
    serverVersion: async () => 'SQLite fixture',
    tables: async () => [{ name: 'rates' }],
    columns: async () => [{ table: 'rates', name: 'amount', type: 'integer', nullable: false }],
    indexes: async () => [],
    async readOnlyQuery(_target, sql) {
      statements.push(sql);
      const query = source.prepare(sql);
      return {
        columns: query.columns().map(({ name }) => name),
        rows: query.all().map(Object.values),
        truncated: false,
      };
    },
  };
  const fake = createFakeOpencode();
  const options = { cipher: testCipher, fake, dbDrivers: { ...DB_DRIVERS, [DbType.Postgresql]: driver } };
  let app = await createTestApp(options);
  const messages: Array<{ sessionId: string; directory: string; text: string }> = [];
  const responses = [
    '{"action":"describe","table":"rates"}',
    '{"action":"query","sql":"DELETE FROM rates"}',
    '{"action":"query","sql":"SELECT COUNT(*) AS total FROM rates"}',
    '{"action":"finish","answer":"There are 2 rates."}',
    '{"action":"query","sql":"SELECT MIN(amount) AS minimum FROM rates"}',
    '{"action":"finish","answer":"The minimum is 23."}',
    '{"action":"query","sql":"SELECT MAX(amount) AS maximum FROM rates"}',
    '{"action":"finish","answer":"The maximum is 42."}',
    '{"action":"finish","answer":"The cached amounts are 23 and 42."}',
  ];
  fake.promptDocument = async ({ sessionId, agent, directory, text }) => {
    messages.push({ sessionId, directory, text });
    expect(agent).toBe(OPENCODE_DATABASE_INVESTIGATOR_AGENT);
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected model turn');
    return response;
  };
  try {
    const { project } = await addProject(app);
    const { project: otherProject } = await addProject(app);
    const { body: connection } = await app.call(createDbConnectionOp, {
      name: 'rates',
      type: 'postgresql',
      host: '127.0.0.1',
      port: 5432,
      database: 'fixture',
      username: 'reader',
      password: 'fixture-password',
      tlsMode: 'off',
    });
    await app.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [connection.id] });
    const { body: conversation } = await app.call(createConversationOp, { title: 'Rates', projectId: project.id });
    const { body: other } = await app.call(createConversationOp, { title: 'Other', projectId: project.id });
    const scope = { owner: { kind: 'assistant' as const, id: conversation.id }, projectId: project.id };
    expect(app.app.services.databaseInvestigations.list(scope)).toEqual([]);
    const first = await app.app.services.databaseInvestigations.investigate({
      ...scope,
      input: { connection: 'rates', question: 'How many rates?' },
    });
    expect(first).toMatchObject({
      status: 'completed',
      answer: 'There are 2 rates.',
      evidence: [
        { kind: 'describe', sql: null, rowCount: null },
        {
          kind: 'query',
          sql: 'SELECT COUNT(*) AS total FROM rates',
          rowCount: 1,
          truncated: false,
          durationMs: expect.any(Number),
        },
      ],
    });
    expect(statements).toEqual(['SELECT COUNT(*) AS total FROM rates']);
    expect(messages[2]?.text).toContain(ErrorCode.DbQueryRejected);
    expect(messages[3]?.text).toContain('[[2]]');
    expect(JSON.stringify(messages)).not.toContain('fixture-password');
    const session = fake.sessions.find(({ id }) => id === messages[0]?.sessionId);
    expect(session).toMatchObject({ permission: [{ permission: '*', pattern: '*', action: 'deny' }] });

    const ref = { ...scope, investigationId: first.investigationId };
    expect(() =>
      app.app.services.databaseInvestigations.get({ ...ref, owner: { kind: 'assistant', id: other.id } }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.NotFound }));
    expect(() => app.app.services.databaseInvestigations.get({ ...ref, projectId: otherProject.id })).toThrow(
      expect.objectContaining({ code: ErrorCode.NotFound }),
    );

    const dataDir = app.dataDir;
    await app.close();
    app = await createTestApp({ ...options, dataDir });
    const investigate = app.app.services.databaseInvestigations.investigate;
    const followup = (question: string, signal?: AbortSignal) =>
      investigate({
        ...scope,
        ...(signal === undefined ? {} : { signal }),
        input: { connection: 'rates', question, investigation_id: first.investigationId },
      });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const respond = fake.promptDocument;
    fake.promptDocument = async (request) => {
      if (request.text.includes('What is the minimum?')) {
        entered.resolve();
        await release.promise;
      }
      return respond(request);
    };
    const secondRun = followup('What is the minimum?');
    await Promise.race([
      entered.promise,
      secondRun.then(() => {
        throw new Error('Expected second turn to enter the model');
      }),
    ]);
    const cancelled = new AbortController();
    const cancelledWaiter = expect(followup('Cancelled while waiting', cancelled.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const thirdRun = followup('What is the maximum?');
    const fourthRun = followup('What are the two amounts?');
    try {
      cancelled.abort();
      await cancelledWaiter;
      expect(app.app.services.databaseInvestigations.get(ref)).toMatchObject({
        status: 'running',
        question: 'What is the minimum?',
      });
    } finally {
      release.resolve();
    }
    const [second, third, fourth] = await Promise.all([secondRun, thirdRun, fourthRun]);
    expect(second).toMatchObject({
      investigationId: first.investigationId,
      status: 'completed',
      answer: 'The minimum is 23.',
    });
    expect(third).toMatchObject({
      investigationId: first.investigationId,
      status: 'completed',
      answer: 'The maximum is 42.',
    });
    expect(fourth.turns.map(({ answer }) => answer)).toEqual([
      'There are 2 rates.',
      'The minimum is 23.',
      'The maximum is 42.',
      'The cached amounts are 23 and 42.',
    ]);
    expect(fourth.evidence).toHaveLength(4);
    expect(new Set(messages.map(({ sessionId, directory }) => [sessionId, directory].join('/'))).size).toBe(1);
    expect(statements).toEqual([
      'SELECT COUNT(*) AS total FROM rates',
      'SELECT MIN(amount) AS minimum FROM rates',
      'SELECT MAX(amount) AS maximum FROM rates',
    ]);

    // Revocation and regrant issue a different grant even when the clock did not tick.
    await app.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [] });
    await app.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [connection.id] });
    await expect(
      app.app.services.databaseInvestigations.investigate({
        ...scope,
        input: { connection: 'rates', question: 'Try the old investigation', investigation_id: first.investigationId },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.DbConnectionNotFound });
    await app.app.services.databaseInvestigations.cleanup();
    expect(fake.sessions.some(({ id }) => id === messages[0]?.sessionId)).toBe(false);

    const final = await app.call(deleteConversationOp, { id: conversation.id });
    expect(final.status).toBe(204);
    expect(app.app.services.databaseInvestigations.list(scope)).toEqual([]);
  } finally {
    await app.close();
    source.close();
  }
});

it('cancels active work for its exact owner and records unavailable native sessions after restart', async () => {
  const fake = createFakeOpencode();
  let app = await createTestApp({ cipher: testCipher, fake });
  try {
    const { project } = await addProject(app);
    const { body: connection } = await app.call(createDbConnectionOp, {
      name: 'test',
      type: 'postgresql',
      host: '127.0.0.1',
      port: 5432,
      database: 'fixture',
      username: 'reader',
      password: '',
      tlsMode: 'off',
    });
    await app.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [connection.id] });
    const { body: conversation } = await app.call(createConversationOp, { title: 'Cancel', projectId: project.id });
    const scope = { owner: { kind: 'assistant' as const, id: conversation.id }, projectId: project.id };
    const entered = Promise.withResolvers<{ sessionId: string; directory: string }>();
    fake.promptDocument = ({ sessionId, directory, signal }) => {
      entered.resolve({ sessionId, directory });
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
    };
    const run = app.app.services.databaseInvestigations.investigate({
      ...scope,
      input: { connection: 'test', question: 'Cancelled question' },
      attemptId: 'attempt-1',
    });
    const nativeSession = await Promise.race([
      entered.promise,
      run.then(() => {
        throw new Error('Expected the model to begin');
      }),
    ]);
    const [current] = app.app.services.databaseInvestigations.list(scope);
    if (!current) throw new Error('Expected the running investigation');
    expect(current).toMatchObject({ status: 'running', attemptId: 'attempt-1' });
    await expect(
      app.app.services.databaseInvestigations.cancel({
        ...scope,
        owner: { ...scope.owner, id: 'another-conversation' },
        investigationId: current.investigationId,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NotFound });
    const cancelled = await app.app.services.databaseInvestigations.cancel({
      ...scope,
      investigationId: current.investigationId,
    });
    await expect(run).resolves.toMatchObject({ status: 'cancelled' });
    expect(cancelled.turns).toMatchObject([{ status: 'cancelled', attemptId: 'attempt-1' }]);
    await fake.deleteSession(nativeSession);

    const dataDir = app.dataDir;
    await app.close();
    app = await createTestApp({ cipher: testCipher, fake, dataDir });
    fake.promptDocument = async ({ sessionId }) => {
      expect(sessionId).toBe(nativeSession.sessionId);
      throw new AppError(ErrorCode.OpencodeRequestFailed, 'Missing fixture session', { sessionMissing: true });
    };
    const missing = await app.app.services.databaseInvestigations.investigate({
      ...scope,
      input: { connection: 'test', question: 'Continue', investigation_id: current.investigationId },
    });
    expect(missing).toMatchObject({
      status: 'failed',
      limitations: [expect.stringContaining('stored model session is unavailable')],
    });
    expect(fake.sessions.some(({ id }) => id === nativeSession.sessionId)).toBe(false);

    await app.call(updateDbConnectionOp, { id: connection.id, database: 'other-fixture' });
    await expect(
      app.app.services.databaseInvestigations.investigate({
        ...scope,
        input: {
          connection: 'test',
          question: 'Continue after reconfiguration',
          investigation_id: current.investigationId,
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.DbConnectionNotFound });
    await app.app.services.databaseInvestigations.cleanup();
    await expect(access(join(dataDir, 'database-investigations', current.investigationId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await app.close();
  }
});
