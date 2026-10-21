import { AppError, DB_CONNECT_TIMEOUT_MS, ErrorCode } from '@aw/shared';
import mysql from 'mysql2';
import { z } from 'zod';
import type { DbDriver, DbTarget } from '../databases.driver.ts';
import { toJsonValue } from './values.ts';

type Connection = ReturnType<typeof mysql.createConnection>;

/** `ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION`: the read-only transaction stopped a write. */
const ER_READ_ONLY_TRANSACTION = 1792;
/** `ER_QUERY_TIMEOUT`: `MAX_EXECUTION_TIME` interrupted the statement. */
const ER_QUERY_TIMEOUT = 3024;
/** mysql2's own timeout of a query (it then destroys the connection). */
const CLIENT_TIMEOUT_CODE = 'PROTOCOL_SEQUENCE_TIMEOUT';
/**
 * The server enforces the time limit on SELECT (`MAX_EXECUTION_TIME`); the client's own timeout, a little later, bounds
 * the other statements.
 */
const CLIENT_TIMEOUT_GRACE_MS = 1000;

const driverErrorSchema = z.object({
  message: z.string(),
  errno: z.number().optional(),
  code: z.string().optional(),
  fatal: z.boolean().optional(),
});

/** A failed statement as a domain error (06 §2.1 translation). */
function queryError(err: unknown): AppError {
  const e = driverErrorSchema.parse(err);
  const details = { driverMessage: e.message };
  if (e.errno === ER_READ_ONLY_TRANSACTION) {
    return new AppError(ErrorCode.DbQueryRejected, 'The statement tried to write', details);
  }
  if (e.errno === ER_QUERY_TIMEOUT || e.code === CLIENT_TIMEOUT_CODE) {
    return new AppError(ErrorCode.DbQueryTimeout, 'The statement ran out of time', details);
  }
  // A fatal error without a server error number is the connection itself going away.
  if (e.fatal === true && e.errno === undefined) {
    return new AppError(ErrorCode.DbConnectionFailed, 'The database connection was lost', details);
  }
  return new AppError(ErrorCode.DbQueryFailed, 'The statement failed', details);
}

async function open(target: DbTarget): Promise<Connection> {
  const connection = mysql.createConnection({
    host: target.host,
    port: target.port,
    user: target.username,
    password: target.password,
    database: target.database,
    ...(target.tls ? { ssl: {} } : {}),
    connectTimeout: DB_CONNECT_TIMEOUT_MS,
    // Values must survive JSON: dates and big numbers as strings.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  await new Promise<void>((resolve, reject) => {
    connection.connect((err) => {
      if (err === null) resolve();
      else
        reject(
          new AppError(ErrorCode.DbConnectionFailed, 'Could not connect to the database', {
            driverMessage: err.message,
          }),
        );
    });
  });
  return connection;
}

/** Each call has a connection of its own, closed afterwards whatever happens. */
async function withConnection<T>(target: DbTarget, work: (connection: Connection) => Promise<T>): Promise<T> {
  const connection = await open(target);
  try {
    return await work(connection);
  } finally {
    connection.destroy();
  }
}

function run(connection: Connection, sql: string, values: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    connection.query(sql, values, (err, result) => {
      if (err === null) resolve(result);
      else reject(queryError(err));
    });
  });
}

const fieldsSchema = z.array(z.object({ name: z.string() }));
const rowSchema = z.array(z.unknown());

/** Streams the result and stops reading (closing the connection) once `maxRows` rows are in. */
function streamRows(connection: Connection, sql: string, maxRows: number, timeoutMs: number) {
  return new Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }>((resolve, reject) => {
    let columns: string[] = [];
    const rows: unknown[][] = [];
    let settled = false;
    const finish = (truncated: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ columns, rows, truncated });
    };
    const query = connection.query({ sql, rowsAsArray: true, timeout: timeoutMs });
    query.on('fields', (fields: unknown) => {
      columns = fieldsSchema.parse(fields).map((f) => f.name);
    });
    query.on('result', (row: unknown) => {
      if (settled) return;
      if (rows.length === maxRows) {
        finish(true);
        connection.destroy();
        return;
      }
      rows.push(rowSchema.parse(row).map(toJsonValue));
    });
    query.on('error', (err: unknown) => {
      // After truncation the connection was closed on purpose; what it reports then is not a result.
      if (settled) return;
      settled = true;
      reject(queryError(err));
    });
    query.on('end', () => finish(false));
  });
}

const tableRowSchema = z.object({
  name: z.string(),
  comment: z.string(),
  rowEstimate: z.coerce.number().nullable(),
});
const columnRowSchema = z.object({
  tableName: z.string(),
  name: z.string(),
  type: z.string(),
  nullable: z.enum(['YES', 'NO']),
  keyName: z.string(),
  defaultValue: z.string().nullable(),
  comment: z.string(),
});
const indexRowSchema = z.object({ name: z.string(), columnName: z.string().nullable(), nonUnique: z.coerce.number() });

/** MySQL and GoldenDB (MySQL protocol) through mysql2 (D07, D97). */
export const mysqlDriver: DbDriver = {
  serverVersion: (target) =>
    withConnection(target, async (connection) => {
      const [row] = z
        .array(z.object({ version: z.string() }))
        .parse(await run(connection, 'SELECT VERSION() AS version'));
      if (row === undefined) throw new Error('SELECT VERSION() returned no row');
      return row.version;
    }),

  tables: (target) =>
    withConnection(target, async (connection) => {
      const rows = z
        .array(tableRowSchema)
        .parse(
          await run(
            connection,
            'SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment, TABLE_ROWS AS rowEstimate FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
          ),
        );
      return rows.map((r) => ({
        name: r.name,
        ...(r.comment === '' ? {} : { comment: r.comment }),
        ...(r.rowEstimate === null ? {} : { rows: r.rowEstimate }),
      }));
    }),

  columns: (target, table) =>
    withConnection(target, async (connection) => {
      const rows = z.array(columnRowSchema).parse(
        await run(
          connection,
          `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_KEY AS keyName, COLUMN_DEFAULT AS defaultValue, COLUMN_COMMENT AS comment
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() ${table === undefined ? '' : 'AND TABLE_NAME = ?'}
             ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          table === undefined ? [] : [table],
        ),
      );
      return rows.map((r) => ({
        table: r.tableName,
        name: r.name,
        type: r.type,
        nullable: r.nullable === 'YES',
        ...(r.keyName === '' ? {} : { key: r.keyName }),
        ...(r.defaultValue === null ? {} : { default: r.defaultValue }),
        ...(r.comment === '' ? {} : { comment: r.comment }),
      }));
    }),

  indexes: (target, table) =>
    withConnection(target, async (connection) => {
      const rows = z.array(indexRowSchema).parse(
        await run(
          connection,
          `SELECT INDEX_NAME AS name, COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
             ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
          [table],
        ),
      );
      const byName = new Map<string, { name: string; columns: string[]; unique: boolean }>();
      for (const row of rows) {
        const index = byName.get(row.name) ?? { name: row.name, columns: [], unique: row.nonUnique === 0 };
        // Functional key parts have no column.
        if (row.columnName !== null) index.columns.push(row.columnName);
        byName.set(row.name, index);
      }
      return [...byName.values()];
    }),

  readOnlyQuery: (target, sql, { maxRows, timeoutMs }) =>
    withConnection(target, async (connection) => {
      await run(connection, 'SET SESSION MAX_EXECUTION_TIME = ?', [timeoutMs]);
      await run(connection, 'START TRANSACTION READ ONLY');
      return streamRows(connection, sql, maxRows, timeoutMs + CLIENT_TIMEOUT_GRACE_MS);
    }),
};
