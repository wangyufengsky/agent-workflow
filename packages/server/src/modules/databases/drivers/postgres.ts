import { AppError, DB_CONNECT_TIMEOUT_MS, DbTlsMode, ErrorCode } from '@aw/shared';
import GaussdbCursor from 'gaussdb-cursor';
import gaussdb from 'gaussdb-node';
import pg from 'pg';
import PgCursor from 'pg-cursor';
import { z } from 'zod';
import type { DbDriver, DbTarget } from '../databases.driver.ts';
import { toJsonValue } from './values.ts';

/** A pg-compatible client library and its cursor (24 §1). */
type PostgresLibrary = { Client: typeof pg.Client; Cursor: typeof PgCursor };
type Client = pg.Client;

/** SQLSTATE `read_only_sql_transaction`: the read-only transaction stopped a write. */
const READ_ONLY_TRANSACTION = '25006';
/** SQLSTATE `query_canceled`: `statement_timeout` interrupted the statement. */
const QUERY_CANCELED = '57014';

/** Dates and times stay the text the server sent, as with MySQL (12 §6.11); other types use pg's parsers. */
const types = new pg.TypeOverrides();
for (const oid of [
  pg.types.builtins.DATE,
  pg.types.builtins.TIME,
  pg.types.builtins.TIMETZ,
  pg.types.builtins.TIMESTAMP,
  pg.types.builtins.TIMESTAMPTZ,
]) {
  types.setTypeParser(oid, 'text', (value) => value);
}

const driverErrorSchema = z.object({ message: z.string(), code: z.string().optional() });

/** A failed statement as a domain error (06 §2.1 translation). */
function queryError(err: unknown): AppError {
  const e = driverErrorSchema.parse(err);
  const details = { driverMessage: e.message };
  if (e.code === READ_ONLY_TRANSACTION)
    return new AppError(ErrorCode.DbQueryRejected, 'The statement tried to write', details);
  if (e.code === QUERY_CANCELED)
    return new AppError(ErrorCode.DbQueryTimeout, 'The statement ran out of time', details);
  // Server errors carry a SQLSTATE; without one the connection itself failed.
  if (e.code === undefined)
    return new AppError(ErrorCode.DbConnectionFailed, 'The database connection was lost', details);
  return new AppError(ErrorCode.DbQueryFailed, 'The statement failed', details);
}

async function run(client: Client, sql: string, values: unknown[] = []): Promise<unknown[]> {
  try {
    return (await client.query(sql, values)).rows;
  } catch (err) {
    throw queryError(err);
  }
}

/** pg's `ssl` for each mode (D166); `{}` checks the certificate against Node's default CAs (D164). */
function sslOf(mode: DbTlsMode) {
  switch (mode) {
    case DbTlsMode.Off:
      return false;
    case DbTlsMode.Verify:
      return {};
    case DbTlsMode.NoVerify:
      return { rejectUnauthorized: false };
  }
}

/** Tables, views and materialized views of the connection's current schema (24 §3). */
const RELATION_KINDS = `('r', 'p', 'v', 'm', 'f')`;

const tableRowSchema = z.object({
  name: z.string(),
  comment: z.string().nullable(),
  rowEstimate: z.coerce.number().nullable(),
});
const columnRowSchema = z.object({
  tableName: z.string(),
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  isPrimary: z.boolean(),
  defaultValue: z.string().nullable(),
  comment: z.string().nullable(),
});
const indexRowSchema = z.object({ name: z.string(), columnName: z.string(), unique: z.boolean() });
const versionRowSchema = z.array(z.object({ version: z.string() }));

/** PostgreSQL protocol drivers: PostgreSQL through pg, openGauss / GaussDB through Huawei's fork of it (D97). */
function createPostgresDriver({ Client, Cursor }: PostgresLibrary): DbDriver {
  /** Each call has a connection of its own, closed afterwards whatever happens. */
  async function withClient<T>(target: DbTarget, work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({
      host: target.host,
      port: target.port,
      user: target.username,
      password: target.password,
      database: target.database,
      ssl: sslOf(target.tlsMode),
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
      types,
    });
    // A connection dropped while idle is reported by the query that uses it; without a listener it would crash.
    client.on('error', () => {});
    try {
      await client.connect();
    } catch (err) {
      throw new AppError(ErrorCode.DbConnectionFailed, 'Could not connect to the database', {
        driverMessage: driverErrorSchema.parse(err).message,
      });
    }
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  return {
    serverVersion: (target) =>
      withClient(target, async (client) => {
        const [row] = versionRowSchema.parse(await run(client, 'SELECT version() AS version'));
        if (row === undefined) throw new Error('SELECT version() returned no row');
        // Product and version without the build details: "PostgreSQL 17.6 (Debian …) on aarch64-…, compiled by …",
        // "(openGauss 7.0.0-RC3 build f08516a2) compiled at …".
        const [product = row.version] = row.version.split(/ on | compiled at /);
        return product.replace(/^\((.*)\)$/, '$1');
      }),

    tables: (target) =>
      withClient(target, async (client) => {
        const rows = z.array(tableRowSchema).parse(
          await run(
            client,
            `SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment,
                CASE WHEN c.relkind IN ('r', 'p', 'm') AND c.reltuples >= 0 THEN c.reltuples::bigint END AS "rowEstimate"
               FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = current_schema() AND c.relkind IN ${RELATION_KINDS}
               ORDER BY c.relname`,
          ),
        );
        return rows.map((r) => ({
          name: r.name,
          ...(r.comment === null ? {} : { comment: r.comment }),
          ...(r.rowEstimate === null ? {} : { rows: r.rowEstimate }),
        }));
      }),

    columns: (target, table) =>
      withClient(target, async (client) => {
        // A primary key's columns are the first indnkeyatts of indkey (INCLUDE columns follow). The slice is spaced:
        // openGauss reads `:name` as a bind placeholder.
        const rows = z.array(columnRowSchema).parse(
          await run(
            client,
            `SELECT c.relname AS "tableName", a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
                NOT a.attnotnull AS nullable,
                EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                         WHERE i.indrelid = c.oid AND i.indisprimary
                           AND a.attnum = ANY ((i.indkey::int2[])[0 : i.indnkeyatts - 1])) AS "isPrimary",
                pg_get_expr(d.adbin, d.adrelid) AS "defaultValue", col_description(c.oid, a.attnum) AS comment
               FROM pg_catalog.pg_attribute a
               JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
               WHERE n.nspname = current_schema() AND c.relkind IN ${RELATION_KINDS}
                 AND a.attnum > 0 AND NOT a.attisdropped ${table === undefined ? '' : 'AND c.relname = $1'}
               ORDER BY c.relname, a.attnum`,
            table === undefined ? [] : [table],
          ),
        );
        return rows.map((r) => ({
          table: r.tableName,
          name: r.name,
          type: r.type,
          nullable: r.nullable,
          ...(r.isPrimary ? { key: 'PRI' } : {}),
          ...(r.defaultValue === null ? {} : { default: r.defaultValue }),
          ...(r.comment === null ? {} : { comment: r.comment }),
        }));
      }),

    indexes: (target, table) =>
      withClient(target, async (client) => {
        // generate_series in the select list rather than LATERAL: openGauss follows PostgreSQL 9.2. Only the key
        // columns (the first indnkeyatts); INCLUDE columns follow them and are not part of the key.
        const rows = z.array(indexRowSchema).parse(
          await run(
            client,
            `SELECT name, "unique", pg_get_indexdef(indexrelid, n, true) AS "columnName"
               FROM (SELECT ic.relname AS name, i.indisunique AS "unique", i.indexrelid,
                            generate_series(1, i.indnkeyatts) AS n
                       FROM pg_catalog.pg_index i
                       JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
                       JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
                       JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
                      WHERE ns.nspname = current_schema() AND c.relname = $1) s
               ORDER BY name, n`,
            [table],
          ),
        );
        const byName = new Map<string, { name: string; columns: string[]; unique: boolean }>();
        for (const row of rows) {
          const index = byName.get(row.name) ?? { name: row.name, columns: [], unique: row.unique };
          index.columns.push(row.columnName);
          byName.set(row.name, index);
        }
        return [...byName.values()];
      }),

    readOnlyQuery: (target, sql, { maxRows, timeoutMs }) =>
      withClient(target, async (client) => {
        await run(client, 'START TRANSACTION READ ONLY');
        // statement_timeout bounds every statement on the server; SET takes no parameters, the value is an integer.
        await run(client, `SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
        // A cursor uses the extended protocol: one statement only, and only the rows asked for leave the server.
        const cursor = client.query(new Cursor(sql, undefined, { rowMode: 'array' }));
        const { rows, columns } = await new Promise<{ rows: unknown[][]; columns: string[] }>((resolve, reject) => {
          cursor.read(maxRows + 1, (err, read, result) => {
            if (err === undefined || err === null) {
              resolve({ rows: z.array(z.array(z.unknown())).parse(read), columns: result.fields.map((f) => f.name) });
            } else reject(queryError(err));
          });
        });
        return {
          columns,
          rows: rows.slice(0, maxRows).map((row) => row.map(toJsonValue)),
          truncated: rows.length > maxRows,
        };
      }),
  };
}

export const postgresDriver = createPostgresDriver({ Client: pg.Client, Cursor: PgCursor });
export const openGaussDriver = createPostgresDriver({ Client: gaussdb.Client, Cursor: GaussdbCursor });
