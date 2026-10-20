import { randomUUID } from 'node:crypto';
import {
  AppError,
  type CreateDbConnectionRequest,
  CredentialKind,
  DB_QUERY_MAX_ROWS,
  type DbConnectionDTO,
  type DbDescribeOutput,
  type DbQueryOutput,
  type DbSchemaDTO,
  type DbTestResultDTO,
  ErrorCode,
  type UpdateDbConnectionRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import type { CredentialsService } from '../credentials/index.ts';
import type { DbDriver, DbTarget } from './databases.driver.ts';
import { createDatabasesRepo, type DbConnection } from './databases.repo.ts';
import { assertReadOnlySql } from './databases.sql.ts';

export type DatabasesServiceDeps = {
  db: Db;
  clock: Clock;
  log: Logger;
  credentials: CredentialsService;
  driver: DbDriver;
  /** `DB_QUERY_TIMEOUT_MS` in production; tests shorten it. */
  queryTimeoutMs: number;
};

const toDto = ({ credentialId: _credential, ...connection }: DbConnection): DbConnectionDTO => connection;

/**
 * Project databases (D07, 11 §9): connections with their password in the credentials module, project links, schema
 * browsing, and the read-only access of the AI's database tools (12 §6.9–6.11).
 */
export function createDatabasesService({ db, clock, log, credentials, driver, queryTimeoutMs }: DatabasesServiceDeps) {
  const repo = createDatabasesRepo(db);

  function get(id: string): DbConnection {
    const connection = repo.find(id);
    if (connection === undefined) {
      throw new AppError(ErrorCode.DbConnectionNotFound, `Database connection ${id} not found`, { id });
    }
    return connection;
  }

  function assertNameFree(name: string, id?: string): void {
    const existing = repo.findByName(name);
    if (existing !== undefined && existing.id !== id) {
      throw new AppError(ErrorCode.DbConnectionAlreadyExists, `A connection named ${name} exists`, { name });
    }
  }

  async function target(connection: DbConnection): Promise<DbTarget> {
    return {
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: await credentials.reveal(connection.credentialId),
      tls: connection.tls,
    };
  }

  /** A connection the project's AI sessions may use, by its name. */
  function linked(projectId: string, name: string): DbConnection {
    const connection = repo.listByProject(projectId).find((c) => c.name === name);
    if (connection === undefined) {
      throw new AppError(ErrorCode.DbConnectionNotFound, `No database connection ${name} for this project`, {
        connection: name,
      });
    }
    return connection;
  }

  return {
    list: (): DbConnectionDTO[] => repo.list().map(toDto),
    get: (id: string): DbConnectionDTO => toDto(get(id)),

    async create({ password, ...fields }: CreateDbConnectionRequest): Promise<DbConnectionDTO> {
      assertNameFree(fields.name);
      const credentialId = await credentials.create(CredentialKind.DbPassword, password);
      const now = clock.now();
      const id = randomUUID();
      repo.insert({ ...fields, id, credentialId, createdAt: now, updatedAt: now });
      log.info({ connectionId: id }, 'database connection added');
      return toDto(get(id));
    },

    async update({ id, password, ...changes }: UpdateDbConnectionRequest): Promise<DbConnectionDTO> {
      const connection = get(id);
      if (changes.name !== undefined) assertNameFree(changes.name, id);
      if (password !== undefined) await credentials.replace(connection.credentialId, password);
      repo.update(id, { ...changes, updatedAt: clock.now() });
      return toDto(get(id));
    },

    /** Projects lose the connection with it (cascade); its password is deleted. */
    delete(id: string): void {
      const connection = get(id);
      db.transaction((tx) => createDatabasesRepo(tx).delete(id));
      credentials.remove(connection.credentialId);
      log.info({ connectionId: id }, 'database connection deleted');
    },

    /** A failed connection is the answer here, not an error. */
    async test(id: string): Promise<DbTestResultDTO> {
      const connectTo = await target(get(id));
      try {
        return { ok: true, serverVersion: await driver.serverVersion(connectTo), error: null };
      } catch (err) {
        if (!(err instanceof AppError && err.code === ErrorCode.DbConnectionFailed)) throw err;
        const message = err.details?.driverMessage;
        return { ok: false, serverVersion: null, error: typeof message === 'string' ? message : err.message };
      }
    },

    async schema(id: string): Promise<DbSchemaDTO> {
      const connectTo = await target(get(id));
      const [tables, columns] = await Promise.all([driver.tables(connectTo), driver.columns(connectTo)]);
      const byTable = Map.groupBy(columns, (c) => c.table);
      return {
        tables: tables.map((table) => ({
          ...table,
          columns: (byTable.get(table.name) ?? []).map(({ table: _table, ...column }) => column),
        })),
      };
    },

    linkedIds: (projectId: string): string[] => repo.listByProject(projectId).map((c) => c.id),
    /** Connections the project's AI sessions may query (12 §6.9). */
    forProject: (projectId: string): DbConnectionDTO[] => repo.listByProject(projectId).map(toDto),
    setProjectLinks(projectId: string, connectionIds: readonly string[]): void {
      for (const id of connectionIds) get(id);
      db.transaction((tx) => createDatabasesRepo(tx).setProjectLinks(projectId, connectionIds));
    },

    /** `db_describe` (12 §6.10): the tables, or one table's columns and indexes. */
    async describe(projectId: string, name: string, table: string | undefined): Promise<DbDescribeOutput> {
      const connectTo = await target(linked(projectId, name));
      if (table === undefined) return { tables: await driver.tables(connectTo) };
      const [columns, indexes] = await Promise.all([
        driver.columns(connectTo, table),
        driver.indexes(connectTo, table),
      ]);
      if (columns.length === 0) {
        throw new AppError(ErrorCode.ValidationFailed, `Table ${table} does not exist`, {
          issues: [{ path: ['table'], message: 'no such table; call db_describe without table to list them' }],
        });
      }
      return { columns: columns.map(({ table: _table, ...column }) => column), indexes };
    },

    /** `db_query` (12 §6.11): one read-only statement, row and time limited. */
    async query(projectId: string, name: string, sql: string, limit: number | undefined): Promise<DbQueryOutput> {
      assertReadOnlySql(sql);
      const connectTo = await target(linked(projectId, name));
      const started = clock.now();
      const result = await driver.readOnlyQuery(connectTo, sql, {
        maxRows: limit ?? DB_QUERY_MAX_ROWS,
        timeoutMs: queryTimeoutMs,
      });
      return { ...result, elapsedMs: clock.now() - started };
    },
  };
}
export type DatabasesService = ReturnType<typeof createDatabasesService>;
