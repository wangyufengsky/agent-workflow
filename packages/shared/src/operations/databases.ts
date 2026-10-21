import { z } from 'zod';
import {
  createDbConnectionRequestSchema,
  dbConnectionSchema,
  dbSchemaSchema,
  dbTestResultSchema,
  updateDbConnectionRequestSchema,
} from '../contracts/api/databases.ts';
import { dbQueryInputSchema, dbQueryOutputSchema } from '../contracts/mcp/db-tools.ts';
import { EntityKind } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const byId = z.object({ id: z.string() });
const common = { expose: { palette: false, assistant: true }, mode: UiMode.Pro } as const;

export const listDbConnectionsOp = defineOperationContract({
  ...common,
  id: 'databases.list',
  title: 'op.databases.list',
  description: 'Database connections (without passwords)',
  input: z.object({}),
  output: z.object({ items: z.array(dbConnectionSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/db-connections' },
  credentialFields: [],
});

export const createDbConnectionOp = defineOperationContract({
  ...common,
  id: 'databases.create',
  title: 'op.databases.create',
  description: 'Add a MySQL connection that AI sessions of linked projects may query read-only',
  input: createDbConnectionRequestSchema,
  output: dbConnectionSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/db-connections', status: 201 },
  credentialFields: ['password'],
  produces: { kind: EntityKind.DbConnection, ref: (connection) => ({ id: connection.id, title: connection.name }) },
});

export const updateDbConnectionOp = defineOperationContract({
  ...common,
  id: 'databases.update',
  title: 'op.databases.update',
  description: 'Change a database connection; the password changes only when given',
  input: updateDbConnectionRequestSchema,
  output: dbConnectionSchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/db-connections/:id' },
  credentialFields: ['password'],
});

export const deleteDbConnectionOp = defineOperationContract({
  ...common,
  id: 'databases.delete',
  title: 'op.databases.delete',
  description: 'Delete a database connection and its stored password; projects lose it',
  input: byId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/db-connections/:id' },
  credentialFields: [],
});

export const testDbConnectionOp = defineOperationContract({
  ...common,
  id: 'databases.test',
  title: 'op.databases.test',
  description: 'Connect to the database and report the server version or the error',
  input: byId,
  output: dbTestResultSchema,
  risk: OperationRisk.Read,
  http: { method: 'POST', path: '/db-connections/:id/test' },
  credentialFields: [],
});

export const dbSchemaOp = defineOperationContract({
  ...common,
  id: 'databases.schema',
  title: 'op.databases.schema',
  description: 'Tables and columns of the connection database',
  input: byId,
  output: dbSchemaSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/db-connections/:id/schema' },
  credentialFields: [],
});

export const queryDbOp = defineOperationContract({
  ...common,
  id: 'databases.query',
  title: 'op.databases.query',
  description:
    'Run one read-only statement (SELECT, SHOW, DESCRIBE or EXPLAIN) on a connection; rows and time are limited',
  input: z.object({ id: z.string(), sql: dbQueryInputSchema.shape.sql, limit: dbQueryInputSchema.shape.limit }),
  output: dbQueryOutputSchema,
  risk: OperationRisk.Read,
  http: { method: 'POST', path: '/db-connections/:id/query' },
  credentialFields: [],
});
