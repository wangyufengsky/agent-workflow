import { AppError, DB_CONNECT_TIMEOUT_MS, ErrorCode } from '@aw/shared';
import { Connection, Request, TYPES } from 'tedious';
import { z } from 'zod';
import type { DbDriver, DbTarget } from '../databases.driver.ts';
import { toJsonValue } from './values.ts';

/** tedious's own timeout of a request: it cancels the statement on the server and fails the request. */
const REQUEST_TIMEOUT_CODE = 'ETIMEOUT';
/** Codes of a connection that went away or was closed while a request ran. */
const CONNECTION_LOST_CODES: ReadonlySet<string> = new Set(['ESOCKET', 'ECLOSE']);
/** Introspection is small; the limit for the user's statements comes from the call. */
const INTROSPECTION_TIMEOUT_MS = 30_000;

const driverErrorSchema = z.object({ message: z.string(), code: z.string().optional() });
/** A row as tedious delivers it (typed `any`): each column's value with its metadata. */
const rowSchema = z.array(
  z.object({ value: z.unknown(), metadata: z.object({ colName: z.string(), type: z.object({ name: z.string() }) }) }),
);
type ColumnValue = z.infer<typeof rowSchema>[number];

/** A failed request as a domain error (06 §2.1 translation). */
function requestError(err: unknown): AppError {
  const e = driverErrorSchema.parse(err);
  const details = { driverMessage: e.message };
  if (e.code === REQUEST_TIMEOUT_CODE)
    return new AppError(ErrorCode.DbQueryTimeout, 'The statement ran out of time', details);
  if (e.code !== undefined && CONNECTION_LOST_CODES.has(e.code)) {
    return new AppError(ErrorCode.DbConnectionFailed, 'The database connection was lost', details);
  }
  return new AppError(ErrorCode.DbQueryFailed, 'The statement failed', details);
}

/**
 * Dates as the text MySQL would give (12 §6.11). With `useUTC` tedious hands the stored wall-clock time over as a UTC
 * Date; tedious keeps milliseconds only.
 */
function toJson({ value, metadata }: ColumnValue): unknown {
  if (!(value instanceof Date)) return toJsonValue(value);
  const iso = value.toISOString();
  switch (metadata.type.name) {
    case 'Date':
      return iso.slice(0, 10);
    case 'Time':
      return iso.slice(11, 23);
    case 'DateTimeOffset':
      return iso;
    default:
      return iso.slice(0, 23).replace('T', ' ');
  }
}

async function open(target: DbTarget, requestTimeoutMs: number): Promise<Connection> {
  const connection = new Connection({
    server: target.host,
    authentication: { type: 'default', options: { userName: target.username, password: target.password } },
    options: {
      port: target.port,
      database: target.database,
      encrypt: target.tls,
      connectTimeout: DB_CONNECT_TIMEOUT_MS,
      requestTimeout: requestTimeoutMs,
    },
  });
  await new Promise<void>((resolve, reject) => {
    connection.connect((err) => {
      if (err === undefined) resolve();
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
async function withConnection<T>(
  target: DbTarget,
  requestTimeoutMs: number,
  work: (connection: Connection) => Promise<T>,
): Promise<T> {
  const connection = await open(target, requestTimeoutMs);
  try {
    return await work(connection);
  } finally {
    connection.close();
  }
}

/** Rows of a parameterized introspection query, as objects by column name. */
function run(connection: Connection, sql: string, params: Record<string, string> = {}): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, unknown>> = [];
    const request = new Request(sql, (err) => {
      if (err === undefined || err === null) resolve(rows);
      else reject(requestError(err));
    });
    for (const [name, value] of Object.entries(params)) request.addParameter(name, TYPES.NVarChar, value);
    request.on('row', (columns: unknown) => {
      rows.push(Object.fromEntries(rowSchema.parse(columns).map((c) => [c.metadata.colName, toJson(c)])));
    });
    connection.execSql(request);
  });
}

/**
 * Streams the first result set; once `maxRows` rows are in, cancels the request (the server stops sending) and
 * resolves when tedious reports the cancellation. Closing the connection while a request still streams makes tedious
 * throw outside any callback, so the connection is closed only afterwards (by the caller, rolling the transaction
 * back). T-SQL runs a batch of statements; later result sets are not read.
 */
function streamRows(connection: Connection, sql: string, maxRows: number) {
  return new Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }>((resolve, reject) => {
    let columns: string[] = [];
    let resultSets = 0;
    const rows: unknown[][] = [];
    let truncated = false;
    const request = new Request(sql, (err) => {
      // The cancellation asked for after truncation ends the request with ECANCEL; that is the expected end.
      if (err === undefined || err === null || truncated) resolve({ columns, rows, truncated });
      else reject(requestError(err));
    });
    request.on('columnMetadata', (metadata) => {
      resultSets += 1;
      if (resultSets === 1) columns = Object.values(metadata).map((m) => m.colName);
    });
    request.on('row', (values: unknown) => {
      if (truncated || resultSets > 1) return;
      if (rows.length === maxRows) {
        truncated = true;
        connection.cancel();
        return;
      }
      rows.push(rowSchema.parse(values).map(toJson));
    });
    connection.execSqlBatch(request);
  });
}

const tableRowSchema = z.object({
  name: z.string(),
  comment: z.string().nullable(),
  rowEstimate: z.coerce.number().nullable(),
});
const columnRowSchema = z.object({
  tableName: z.string(),
  name: z.string(),
  dataType: z.string(),
  maxLength: z.number().nullable(),
  precision: z.number().nullable(),
  scale: z.number().nullable(),
  nullable: z.enum(['YES', 'NO']),
  isPrimary: z.boolean(),
  defaultValue: z.string().nullable(),
  comment: z.string().nullable(),
});
const indexRowSchema = z.object({ name: z.string(), columnName: z.string(), isUnique: z.boolean() });

/** Types declared with a length; `xml`, `text` and the like report one too, but are not written with it. */
const SIZED_TYPES: ReadonlySet<string> = new Set(['char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary']);

/** The full column type, e.g. `nvarchar(64)`, `varbinary(max)`, `decimal(10,2)`. */
function columnType(r: z.infer<typeof columnRowSchema>): string {
  if (SIZED_TYPES.has(r.dataType) && r.maxLength !== null) {
    return `${r.dataType}(${r.maxLength === -1 ? 'max' : r.maxLength})`;
  }
  if ((r.dataType === 'decimal' || r.dataType === 'numeric') && r.precision !== null) {
    return `${r.dataType}(${r.precision},${r.scale ?? 0})`;
  }
  return r.dataType;
}

/** `MS_Description` is the comment SQL Server Management Studio writes. */
const DESCRIPTION = `ep.class = 1 AND ep.name = 'MS_Description'`;
const OBJECT_OF = (schema: string, table: string) => `OBJECT_ID(QUOTENAME(${schema}) + '.' + QUOTENAME(${table}))`;

/**
 * SQL Server through tedious (D98). It has no read-only transaction: the statement check rejects every keyword that
 * writes (24 §4.3) and the batch runs in a transaction that is never committed.
 */
export const sqlServerDriver: DbDriver = {
  serverVersion: (target) =>
    withConnection(target, INTROSPECTION_TIMEOUT_MS, async (connection) => {
      const [row] = z
        .array(z.object({ version: z.string() }))
        .parse(await run(connection, `SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version`));
      if (row === undefined) throw new Error('SERVERPROPERTY returned no row');
      return row.version;
    }),

  tables: (target) =>
    withConnection(target, INTROSPECTION_TIMEOUT_MS, async (connection) => {
      const rows = z.array(tableRowSchema).parse(
        await run(
          connection,
          `SELECT t.TABLE_NAME AS name, CAST(ep.value AS nvarchar(max)) AS comment, p.rowEstimate
             FROM INFORMATION_SCHEMA.TABLES t
             LEFT JOIN sys.extended_properties ep
               ON ep.major_id = ${OBJECT_OF('t.TABLE_SCHEMA', 't.TABLE_NAME')} AND ep.minor_id = 0 AND ${DESCRIPTION}
             OUTER APPLY (SELECT SUM(ps.rows) AS rowEstimate FROM sys.partitions ps
                           WHERE ps.object_id = ${OBJECT_OF('t.TABLE_SCHEMA', 't.TABLE_NAME')}
                             AND ps.index_id IN (0, 1)) p
             WHERE t.TABLE_SCHEMA = SCHEMA_NAME()
             ORDER BY t.TABLE_NAME`,
        ),
      );
      return rows.map((r) => ({
        name: r.name,
        ...(r.comment === null ? {} : { comment: r.comment }),
        ...(r.rowEstimate === null ? {} : { rows: r.rowEstimate }),
      }));
    }),

  columns: (target, table) =>
    withConnection(target, INTROSPECTION_TIMEOUT_MS, async (connection) => {
      const rows = z.array(columnRowSchema).parse(
        await run(
          connection,
          `SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType,
              c.CHARACTER_MAXIMUM_LENGTH AS maxLength, CAST(c.NUMERIC_PRECISION AS int) AS precision,
              c.NUMERIC_SCALE AS scale, c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS defaultValue,
              CAST(ep.value AS nvarchar(max)) AS comment,
              CAST(CASE WHEN EXISTS (
                SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                    ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
                 WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA
                   AND tc.TABLE_NAME = c.TABLE_NAME AND ku.COLUMN_NAME = c.COLUMN_NAME
              ) THEN 1 ELSE 0 END AS bit) AS isPrimary
             FROM INFORMATION_SCHEMA.COLUMNS c
             LEFT JOIN sys.extended_properties ep
               ON ep.major_id = ${OBJECT_OF('c.TABLE_SCHEMA', 'c.TABLE_NAME')}
              AND ep.minor_id = COLUMNPROPERTY(ep.major_id, c.COLUMN_NAME, 'ColumnId') AND ${DESCRIPTION}
             WHERE c.TABLE_SCHEMA = SCHEMA_NAME() ${table === undefined ? '' : 'AND c.TABLE_NAME = @table'}
             ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
          table === undefined ? {} : { table },
        ),
      );
      return rows.map((r) => ({
        table: r.tableName,
        name: r.name,
        type: columnType(r),
        nullable: r.nullable === 'YES',
        ...(r.isPrimary ? { key: 'PRI' } : {}),
        ...(r.defaultValue === null ? {} : { default: r.defaultValue }),
        ...(r.comment === null ? {} : { comment: r.comment }),
      }));
    }),

  indexes: (target, table) =>
    withConnection(target, INTROSPECTION_TIMEOUT_MS, async (connection) => {
      const rows = z.array(indexRowSchema).parse(
        await run(
          connection,
          `SELECT i.name AS name, col.name AS columnName, i.is_unique AS isUnique
             FROM sys.indexes i
             JOIN sys.index_columns ic
               ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
             JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
             WHERE i.object_id = ${OBJECT_OF('SCHEMA_NAME()', '@table')} AND i.name IS NOT NULL
             ORDER BY i.name, ic.key_ordinal`,
          { table },
        ),
      );
      const byName = new Map<string, { name: string; columns: string[]; unique: boolean }>();
      for (const row of rows) {
        const index = byName.get(row.name) ?? { name: row.name, columns: [], unique: row.isUnique };
        index.columns.push(row.columnName);
        byName.set(row.name, index);
      }
      return [...byName.values()];
    }),

  readOnlyQuery: (target, sql, { maxRows, timeoutMs }) =>
    withConnection(target, timeoutMs, async (connection) => {
      // Never committed: closing the connection rolls back whatever the batch did.
      await new Promise<void>((resolve, reject) => {
        connection.beginTransaction((err) => {
          if (err === undefined || err === null) resolve();
          else reject(requestError(err));
        });
      });
      return streamRows(connection, sql, maxRows);
    }),
};
