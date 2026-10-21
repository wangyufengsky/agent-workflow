import {
  askKnowledgeOp,
  createDbConnectionOp,
  dbSchemaOp,
  deleteDbConnectionOp,
  ErrorCode,
  getKnowledgeOp,
  getProjectOp,
  knowledgeCitationOp,
  listDbConnectionsOp,
  queryDbOp,
  ServerEventType,
  setProjectDbConnectionsOp,
  testDbConnectionOp,
  updateDbConnectionOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { startMysql, type TestMysql } from '../../../test/helpers/mysql.ts';
import { addProject, createTask, nodeReaches } from '../../../test/helpers/tasks.ts';

/** Short enough for a test, long enough for the small queries that must pass. */
const QUERY_TIMEOUT_MS = 1500;

let mysql: TestMysql;
let t: TestApp;

beforeAll(async () => {
  mysql = await startMysql();
  await mysql.exec(`
    CREATE TABLE items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(64) NOT NULL COMMENT '名称',
      price DECIMAL(10, 2) NULL,
      created DATE NULL,
      data VARBINARY(16) NULL,
      KEY idx_name (name)
    ) COMMENT = '商品';
    INSERT INTO items (name, price, created, data) VALUES
      ('a', 1.50, '2026-01-02', X'0102'), ('b', 2, NULL, NULL), ('c', 3, NULL, NULL), ('d', 4, NULL, NULL),
      ('e', 5, NULL, NULL);
  `);
  // A function that writes: only the read-only transaction stops it.
  await mysql.exec(`
    CREATE FUNCTION bump() RETURNS INT DETERMINISTIC MODIFIES SQL DATA
    BEGIN INSERT INTO items (name) VALUES ('bumped'); RETURN 1; END
  `);
}, 180_000);
afterAll(() => mysql.stop());

beforeEach(async () => {
  t = await createTestApp({ cipher: testCipher, dbQueryTimeoutMs: QUERY_TIMEOUT_MS });
});
afterEach(() => t.close());

const connectionInput = (name: string, password = mysql.password) => ({
  name,
  type: 'mysql' as const,
  host: mysql.host,
  port: mysql.port,
  database: mysql.database,
  username: mysql.username,
  password,
  tls: false,
});

describe('数据库连接（11 §9）', () => {
  it('增改删、测试连接、浏览表结构、项目关联；DTO 不含密码', async () => {
    const created = await t.call(createDbConnectionOp, connectionInput('shop-db'));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'shop-db', database: 'shop', tls: false });
    expect(Object.keys(created.body)).not.toContain('password');
    const { id } = created.body;
    expect((await t.call(createDbConnectionOp, connectionInput('shop-db'))).body).toMatchObject({
      error: { code: ErrorCode.DbConnectionAlreadyExists },
    });

    expect((await t.call(testDbConnectionOp, { id })).body).toMatchObject({
      ok: true,
      serverVersion: expect.stringMatching(/^8\.4\./),
      error: null,
    });
    await t.call(updateDbConnectionOp, { id, password: 'wrong' });
    expect((await t.call(testDbConnectionOp, { id })).body).toMatchObject({
      ok: false,
      error: expect.stringContaining('Access denied'),
    });
    await t.call(updateDbConnectionOp, { id, password: mysql.password, name: 'shop' });

    const { body: schema } = await t.call(dbSchemaOp, { id });
    expect(schema.tables).toEqual([
      expect.objectContaining({
        name: 'items',
        comment: '商品',
        columns: [
          { name: 'id', type: 'int', nullable: false, key: 'PRI' },
          { name: 'name', type: 'varchar(64)', nullable: false, key: 'MUL', comment: '名称' },
          { name: 'price', type: 'decimal(10,2)', nullable: true },
          { name: 'created', type: 'date', nullable: true },
          { name: 'data', type: 'varbinary(16)', nullable: true },
        ],
      }),
    ]);

    const { project } = await addProject(t);
    const linked = await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [id] });
    expect(linked.body.dbConnectionIds).toEqual([id]);
    expect((await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: ['nope'] })).body).toMatchObject({
      error: { code: ErrorCode.DbConnectionNotFound },
    });

    expect((await t.call(deleteDbConnectionOp, { id })).status).toBe(204);
    expect((await t.call(listDbConnectionsOp, {})).body.items).toEqual([]);
    expect((await t.call(getProjectOp, { id: project.id })).body.dbConnectionIds).toEqual([]);
  });

  it('只读查询（databases.query，供助手使用）：返回行，拒绝写语句', async () => {
    const { id } = (await t.call(createDbConnectionOp, connectionInput('shop-db'))).body;
    expect((await t.call(queryDbOp, { id, sql: 'SELECT name FROM items ORDER BY id', limit: 2 })).body).toMatchObject({
      columns: ['name'],
      rows: [['a'], ['b']],
      truncated: true,
    });
    expect((await t.call(queryDbOp, { id, sql: "DELETE FROM items WHERE name = 'a'" })).body).toMatchObject({
      error: { code: ErrorCode.DbQueryRejected },
    });
  });
});

describe('数据库工具（12 §6.9–6.11）', () => {
  let mcp: Client;
  let session: string;

  /** An execute attempt of a task whose project is linked to `shop-db` (not to `other-db`). */
  beforeEach(async () => {
    const { body: shop } = await t.call(createDbConnectionOp, connectionInput('shop-db'));
    await t.call(createDbConnectionOp, connectionInput('other-db'));
    const { project } = await addProject(t);
    await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [shop.id] });
    t.fake.enqueue(script().hang(), { title: '· 定位根因' });
    const running = nodeReaches(t, 'locate', 'running');
    await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await running;
    const [first] = t.fake.sessions;
    if (first === undefined) throw new Error('No session');
    session = first.id;
    mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  });
  afterEach(() => mcp.close());

  const call = (name: string, args: Record<string, unknown> = {}) =>
    callTool(mcp, name, { ...args, __aw_session: session });

  it('只列出项目关联的连接（不含主机、用户、密码），任务上下文也列出它们', async () => {
    expect((await call('db_list_connections')).body).toEqual({
      connections: [{ name: 'shop-db', type: 'mysql', database: 'shop' }],
    });
    expect((await call('get_task_context')).body).toMatchObject({ databases: [{ name: 'shop-db', type: 'mysql' }] });
    expect(await call('db_query', { connection: 'other-db', sql: 'SELECT 1' })).toMatchObject({
      isError: true,
      body: { code: ErrorCode.DbConnectionNotFound, hint: expect.stringContaining('db_list_connections') },
    });
  });

  it('查看表与表结构；表不存在时 VALIDATION_FAILED', async () => {
    expect((await call('db_describe', { connection: 'shop-db' })).body).toEqual({
      tables: [expect.objectContaining({ name: 'items', comment: '商品' })],
    });
    const { body } = await call('db_describe', { connection: 'shop-db', table: 'items' });
    expect(body).toMatchObject({
      columns: expect.arrayContaining([
        { name: 'name', type: 'varchar(64)', nullable: false, key: 'MUL', comment: '名称' },
      ]),
      indexes: [
        { name: 'idx_name', columns: ['name'], unique: false },
        { name: 'PRIMARY', columns: ['id'], unique: true },
      ],
    });
    expect(await call('db_describe', { connection: 'shop-db', table: 'nope' })).toMatchObject({
      isError: true,
      body: { code: ErrorCode.ValidationFailed },
    });
  });

  it('只读查询：结果可序列化，按 limit 截断', async () => {
    const sql = 'SELECT id, name, price, created, data FROM items ORDER BY id';
    const limited = await call('db_query', { connection: 'shop-db', sql, limit: 2 });
    expect(limited.body).toMatchObject({
      columns: ['id', 'name', 'price', 'created', 'data'],
      rows: [
        [1, 'a', '1.50', '2026-01-02', '0x0102'],
        [2, 'b', '2.00', null, null],
      ],
      truncated: true,
      elapsedMs: expect.any(Number),
    });
    expect((await call('db_query', { connection: 'shop-db', sql })).body).toMatchObject({ truncated: false });
  });

  it('拒绝写语句与多条语句；绕过语句检查的写入被只读事务拦下', async () => {
    for (const sql of ['DELETE FROM items', 'SELECT 1; DROP TABLE items']) {
      expect(await call('db_query', { connection: 'shop-db', sql })).toMatchObject({
        isError: true,
        body: { code: ErrorCode.DbQueryRejected, hint: expect.stringContaining('read-only') },
      });
    }
    expect((await call('db_query', { connection: 'shop-db', sql: 'SELECT bump()' })).body).toMatchObject({
      code: ErrorCode.DbQueryRejected,
      details: { driverMessage: expect.stringContaining('READ ONLY') },
    });
    // BIGINT comes back as a string: it may exceed what JSON numbers hold.
    expect((await call('db_query', { connection: 'shop-db', sql: 'SELECT COUNT(*) FROM items' })).body).toMatchObject({
      rows: [['5']],
    });
  });

  it('超时返回 DB_QUERY_TIMEOUT，SQL 错误返回 DB_QUERY_FAILED', async () => {
    expect(
      (await call('db_query', { connection: 'shop-db', sql: 'SELECT id, SLEEP(5) FROM items' })).body,
    ).toMatchObject({ code: ErrorCode.DbQueryTimeout });
    expect((await call('db_query', { connection: 'shop-db', sql: 'SELECT nope FROM items' })).body).toMatchObject({
      code: ErrorCode.DbQueryFailed,
      details: { driverMessage: expect.stringContaining("Unknown column 'nope'") },
    });
  });
});

describe('知识问答的数据库来源（18 §6）', () => {
  it('研究员查询关联的数据库并引用；连接与只读都经过校验，打开原文时重新执行查询', async () => {
    const { body: shop } = await t.call(createDbConnectionOp, connectionInput('shop-db'));
    const { project } = await addProject(t);
    await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [shop.id] });
    const sql = "SELECT name, price FROM items WHERE name = 'a'";
    t.fake.enqueue(
      script()
        .callTool('db_list_connections')
        .callTool('db_query', { connection: 'shop-db', sql })
        .callTool('submit_answer', {
          answer: 'a costs 1.50 [1] [2].',
          citations: [
            { type: 'database', connection: 'other-db', sql },
            { type: 'database', connection: 'shop-db', sql: 'DELETE FROM items' },
          ],
        })
        .callTool('submit_answer', {
          answer: 'a costs 1.50 [1].',
          citations: [{ type: 'database', connection: 'shop-db', sql }],
        }),
      { agent: 'aw-researcher' },
    );
    const answered = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.status === 'succeeded',
    );
    const { body } = await t.call(askKnowledgeOp, {
      projectId: project.id,
      question: 'What does a cost?',
      sources: { code: false, docs: false, database: true, web: false },
    });
    await answered;
    await t.fake.settled();

    expect(t.fake.toolCalls.map((c) => [c.name, c.isError])).toEqual([
      ['db_list_connections', false],
      ['db_query', false],
      ['submit_answer', true],
      ['submit_answer', false],
    ]);
    expect(t.fake.toolCalls[0]?.result).toEqual({
      connections: [{ name: 'shop-db', type: 'mysql', database: mysql.database }],
    });
    expect(t.fake.toolCalls[2]?.result).toMatchObject({
      code: ErrorCode.KnowledgeCitationInvalid,
      details: {
        problems: [
          { citation: 1, code: 'UNKNOWN_CONNECTION' },
          { citation: 2, code: 'QUERY_NOT_READONLY' },
        ],
      },
    });
    const turn = (await t.call(getKnowledgeOp, { id: body.id })).body.turns[0];
    expect(turn?.citations).toEqual([{ type: 'database', connection: 'shop-db', sql }]);
    expect((await t.call(knowledgeCitationOp, { turnId: turn?.id ?? '', index: 1 })).body).toMatchObject({
      type: 'database',
      connection: 'shop-db',
      result: { columns: ['name', 'price'], rows: [['a', '1.50']] },
    });
  });
});
