import { DbType } from '@aw/shared';
import type { DbDriver } from './databases.driver.ts';
import { databasesOperations } from './databases.operations.ts';
import { createDatabasesService, type DatabasesServiceDeps } from './databases.service.ts';
import { mysqlDriver } from './drivers/mysql.ts';
import { openGaussDriver, postgresDriver } from './drivers/postgres.ts';
import { sqlServerDriver } from './drivers/sqlserver.ts';

export type { DbDriver } from './databases.driver.ts';
export type { DatabasesService } from './databases.service.ts';
export { assertReadOnlySql } from './databases.sql.ts';

/** The driver of each database type (24 §1, D97, D98). */
export const DB_DRIVERS = {
  [DbType.Mysql]: mysqlDriver,
  [DbType.Goldendb]: mysqlDriver,
  [DbType.Postgresql]: postgresDriver,
  [DbType.Opengauss]: openGaussDriver,
  [DbType.Sqlserver]: sqlServerDriver,
} as const satisfies Record<DbType, DbDriver>;

export function createDatabasesModule(deps: DatabasesServiceDeps) {
  const service = createDatabasesService(deps);
  return { service, operations: databasesOperations(service) };
}
