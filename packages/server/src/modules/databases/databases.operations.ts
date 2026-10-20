import {
  createDbConnectionOp,
  dbSchemaOp,
  deleteDbConnectionOp,
  listDbConnectionsOp,
  testDbConnectionOp,
  updateDbConnectionOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { DatabasesService } from './databases.service.ts';

export function databasesOperations(databases: DatabasesService) {
  return [
    implement(listDbConnectionsOp, () => ({ items: databases.list() })),
    implement(createDbConnectionOp, (input) => databases.create(input)),
    implement(updateDbConnectionOp, (input) => databases.update(input)),
    implement(deleteDbConnectionOp, ({ id }) => databases.delete(id)),
    implement(testDbConnectionOp, ({ id }) => databases.test(id)),
    implement(dbSchemaOp, ({ id }) => databases.schema(id)),
  ];
}
