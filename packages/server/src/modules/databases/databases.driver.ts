import type { DbColumn, DbIndex, DbQueryOutput, DbTable } from '@aw/shared';

/** Where and as whom to connect; the password comes from the credentials module just before use. */
export type DbTarget = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  tls: boolean;
};

export type DbQueryLimits = { maxRows: number; timeoutMs: number };

/**
 * A database engine (03 §4.2 extension point; 24 §1). Every call opens its own connection and closes it. Failures
 * are AppErrors: DB_CONNECTION_FAILED, DB_QUERY_FAILED, DB_QUERY_TIMEOUT, DB_QUERY_REJECTED.
 */
export interface DbDriver {
  serverVersion(target: DbTarget): Promise<string>;
  tables(target: DbTarget): Promise<DbTable[]>;
  /** Columns of every table (`table` omitted) or of one; an unknown table has none. */
  columns(target: DbTarget, table?: string): Promise<Array<DbColumn & { table: string }>>;
  indexes(target: DbTarget, table: string): Promise<DbIndex[]>;
  /**
   * One statement already checked by `assertReadOnlySql`, run in a read-only transaction (SQL Server: one never
   * committed) within the limits.
   */
  readOnlyQuery(target: DbTarget, sql: string, limits: DbQueryLimits): Promise<Omit<DbQueryOutput, 'elapsedMs'>>;
}
