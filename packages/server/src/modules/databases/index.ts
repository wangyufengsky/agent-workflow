import { databasesOperations } from './databases.operations.ts';
import { createDatabasesService, type DatabasesServiceDeps } from './databases.service.ts';

export type { DbDriver } from './databases.driver.ts';
export type { DatabasesService } from './databases.service.ts';
export { assertReadOnlySql } from './databases.sql.ts';
export { mysqlDriver } from './drivers/mysql.ts';

export function createDatabasesModule(deps: DatabasesServiceDeps) {
  const service = createDatabasesService(deps);
  return { service, operations: databasesOperations(service) };
}
