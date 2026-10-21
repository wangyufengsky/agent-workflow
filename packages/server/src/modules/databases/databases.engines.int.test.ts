import {
  createDbConnectionOp,
  type DbColumn,
  type DbIndex,
  DbType,
  dbSchemaOp,
  ErrorCode,
  setProjectDbConnectionsOp,
  testDbConnectionOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import {
  DB_IMAGE,
  imageAvailable,
  startOpenGauss,
  startPostgres,
  startSqlServer,
  type TestDatabase,
} from '../../../test/helpers/db-containers.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, createTask, nodeReaches } from '../../../test/helpers/tasks.ts';

/** Short enough for a test, long enough for the small queries that must pass. */
const QUERY_TIMEOUT_MS = 1500;

/**
 * The same table on every engine (24 §6): `items` with a comment, a commented column, an index, five rows. MySQL and
 * GoldenDB are covered by databases.int.test.ts.
 */
type Engine = {
  type: DbType;
  image: string;
  start(): Promise<TestDatabase>;
  /** Statements creating the fixture, one `exec` each. */
  fixture: string[];
  version: RegExp;
  columns: DbColumn[];
  indexes: DbIndex[];
  /** The first two rows of `SELECT id, name, price, created, data FROM items ORDER BY id`. */
  rows: unknown[][];
  sleep: string;
  unknownColumn: string;
  /** A statement the check lets through that writes; the server's read-only transaction stops it. */
  serverRejected?: { sql: string; message: string };
};

const POSTGRES_FIXTURE = [
  `CREATE TABLE items (
     id SERIAL PRIMARY KEY,
     name VARCHAR(64) NOT NULL,
     price NUMERIC(10, 2),
     created DATE,
     data BYTEA
   );
   COMMENT ON TABLE items IS '商品';
   COMMENT ON COLUMN items.name IS '名称';
   CREATE INDEX idx_name ON items (name);
   INSERT INTO items (name, price, created, data) VALUES
     ('a', 1.50, '2026-01-02', '\\x0102'), ('b', 2, NULL, NULL), ('c', 3, NULL, NULL), ('d', 4, NULL, NULL),
     ('e', 5, NULL, NULL);`,
  // A row estimate exists once the table was analyzed; openGauss runs ANALYZE only on its own.
  'ANALYZE items',
  // A function that writes: only the read-only transaction stops it.
  `CREATE FUNCTION bump() RETURNS integer LANGUAGE plpgsql AS $$
   BEGIN INSERT INTO items (name) VALUES ('bumped'); RETURN 1; END $$;`,
];

const postgresFamily = {
  fixture: POSTGRES_FIXTURE,
  columns: [
    { name: 'id', type: 'integer', nullable: false, key: 'PRI', default: "nextval('items_id_seq'::regclass)" },
    { name: 'name', type: 'character varying(64)', nullable: false, comment: '名称' },
    { name: 'price', type: 'numeric(10,2)', nullable: true },
    { name: 'created', type: 'date', nullable: true },
    { name: 'data', type: 'bytea', nullable: true },
  ],
  indexes: [
    { name: 'idx_name', columns: ['name'], unique: false },
    { name: 'items_pkey', columns: ['id'], unique: true },
  ],
  rows: [
    [1, 'a', '1.50', '2026-01-02', '0x0102'],
    [2, 'b', '2.00', null, null],
  ],
  sleep: 'SELECT pg_sleep(5)',
  unknownColumn: 'column "nope" does not exist',
  serverRejected: { sql: 'SELECT bump()', message: 'read-only transaction' },
};

const ENGINES: Engine[] = [
  {
    type: DbType.Postgresql,
    image: DB_IMAGE.postgres,
    start: startPostgres,
    version: /^PostgreSQL 17\./,
    ...postgresFamily,
  },
  {
    type: DbType.Opengauss,
    image: DB_IMAGE.opengauss,
    start: startOpenGauss,
    version: /^openGauss 7\./,
    ...postgresFamily,
    // openGauss databases default to Oracle compatibility, where DATE carries a time of day.
    columns: postgresFamily.columns.map((c) =>
      c.name === 'created' ? { ...c, type: 'timestamp(0) without time zone' } : c,
    ),
    rows: [
      [1, 'a', '1.50', '2026-01-02 00:00:00', '0x0102'],
      [2, 'b', '2.00', null, null],
    ],
  },
  {
    type: DbType.Sqlserver,
    image: DB_IMAGE.sqlserver,
    start: startSqlServer,
    fixture: [
      `CREATE TABLE items (
         id INT IDENTITY PRIMARY KEY,
         name NVARCHAR(64) NOT NULL,
         price DECIMAL(10, 2) NULL,
         created DATE NULL,
         data VARBINARY(16) NULL
       );
       CREATE INDEX idx_name ON items (name);
       INSERT INTO items (name, price, created, data) VALUES
         (N'a', 1.50, '2026-01-02', 0x0102), (N'b', 2, NULL, NULL), (N'c', 3, NULL, NULL), (N'd', 4, NULL, NULL),
         (N'e', 5, NULL, NULL);`,
      `EXEC sp_addextendedproperty 'MS_Description', N'商品', 'SCHEMA', 'dbo', 'TABLE', 'items';
       EXEC sp_addextendedproperty 'MS_Description', N'名称', 'SCHEMA', 'dbo', 'TABLE', 'items', 'COLUMN', 'name';`,
    ],
    version: /^16\./,
    columns: [
      { name: 'id', type: 'int', nullable: false, key: 'PRI' },
      { name: 'name', type: 'nvarchar(64)', nullable: false, comment: '名称' },
      { name: 'price', type: 'decimal(10,2)', nullable: true },
      { name: 'created', type: 'date', nullable: true },
      { name: 'data', type: 'varbinary(16)', nullable: true },
    ],
    indexes: [
      { name: 'idx_name', columns: ['name'], unique: false },
      // SQL Server names an unnamed primary key PK__<table>__<hash>.
      { name: expect.stringMatching(/^PK__items__/), columns: ['id'], unique: true },
    ],
    // tedious gives DECIMAL as a JavaScript number (24 §5).
    rows: [
      [1, 'a', 1.5, '2026-01-02', '0x0102'],
      [2, 'b', 2, null, null],
    ],
    sleep: "SELECT 1 WAITFOR DELAY '00:00:05'",
    unknownColumn: "Invalid column name 'nope'",
  },
];

for (const engine of ENGINES) {
  const available = await imageAvailable(engine.image);

  describe.skipIf(!available)(`${engine.type}（24）`, () => {
    let server: TestDatabase;
    let t: TestApp;
    let mcp: Client;
    let session: string;
    let connectionId: string;

    beforeAll(async () => {
      server = await engine.start();
      for (const sql of engine.fixture) await server.exec(sql);
    }, 300_000);
    afterAll(() => server.stop());

    /** An execute attempt of a task whose project is linked to `shop-db`. */
    beforeEach(async () => {
      t = await createTestApp({ cipher: testCipher, dbQueryTimeoutMs: QUERY_TIMEOUT_MS });
      const { body: shop } = await t.call(createDbConnectionOp, {
        name: 'shop-db',
        type: engine.type,
        host: server.host,
        port: server.port,
        database: server.database,
        username: server.username,
        password: server.password,
        tls: false,
      });
      const { project } = await addProject(t);
      connectionId = shop.id;
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
    afterEach(async () => {
      await mcp.close();
      await t.close();
    });

    const call = (name: string, args: Record<string, unknown>) =>
      callTool(mcp, name, { connection: 'shop-db', ...args, __aw_session: session });

    it('测试连接、浏览表结构、查看表与索引', async () => {
      expect((await t.call(testDbConnectionOp, { id: connectionId })).body).toMatchObject({
        ok: true,
        serverVersion: expect.stringMatching(engine.version),
        error: null,
      });
      expect((await t.call(dbSchemaOp, { id: connectionId })).body.tables).toEqual([
        { name: 'items', comment: '商品', rows: 5, columns: engine.columns },
      ]);
      expect((await call('db_describe', {})).body).toEqual({
        tables: [{ name: 'items', comment: '商品', rows: 5 }],
      });
      expect((await call('db_describe', { table: 'items' })).body).toEqual({
        columns: engine.columns,
        indexes: engine.indexes,
      });
    });

    it('只读查询：值可序列化，按 limit 截断', async () => {
      const sql = 'SELECT id, name, price, created, data FROM items ORDER BY id';
      expect((await call('db_query', { sql, limit: 2 })).body).toMatchObject({
        columns: ['id', 'name', 'price', 'created', 'data'],
        rows: engine.rows,
        truncated: true,
      });
      expect((await call('db_query', { sql })).body).toMatchObject({ truncated: false, rows: { length: 5 } });
      // BIGINT comes back as a string: it may exceed what JSON numbers hold.
      expect((await call('db_query', { sql: 'SELECT CAST(5 AS BIGINT) AS n' })).body).toMatchObject({ rows: [['5']] });
    });

    it('拒绝写语句；超时 DB_QUERY_TIMEOUT；SQL 错误 DB_QUERY_FAILED', async () => {
      expect(await call('db_query', { sql: 'DELETE FROM items' })).toMatchObject({
        isError: true,
        body: { code: ErrorCode.DbQueryRejected },
      });
      if (engine.serverRejected !== undefined) {
        expect((await call('db_query', { sql: engine.serverRejected.sql })).body).toMatchObject({
          code: ErrorCode.DbQueryRejected,
          details: { driverMessage: expect.stringContaining(engine.serverRejected.message) },
        });
      }
      expect((await call('db_query', { sql: engine.sleep })).body).toMatchObject({ code: ErrorCode.DbQueryTimeout });
      expect((await call('db_query', { sql: 'SELECT nope FROM items' })).body).toMatchObject({
        code: ErrorCode.DbQueryFailed,
        details: { driverMessage: expect.stringContaining(engine.unknownColumn) },
      });
    });
  });
}
