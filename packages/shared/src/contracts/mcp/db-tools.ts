import { z } from 'zod';
import { DB_QUERY_MAX_ROWS } from '../../constants/limits.ts';
import { dbTypeSchema } from '../../enums/system.ts';
import { dbColumnSchema, dbIndexSchema, dbTableSchema } from '../api/databases.ts';

/** `db_list_connections` (12 §6.9): the project's connections, without host, user or password. */
export const dbListConnectionsInputSchema = z.object({});
export const dbListConnectionsOutputSchema = z.object({
  connections: z.array(z.object({ name: z.string(), type: dbTypeSchema, database: z.string() })),
});

/** `db_describe` (12 §6.10). */
export const dbDescribeInputSchema = z.object({
  connection: z.string().min(1).describe('Connection name from db_list_connections'),
  table: z.string().min(1).optional().describe('A table to describe; omit to list the tables'),
});
export const dbDescribeOutputSchema = z.union([
  z.object({ tables: z.array(dbTableSchema) }),
  z.object({ columns: z.array(dbColumnSchema), indexes: z.array(dbIndexSchema) }),
]);
export type DbDescribeOutput = z.infer<typeof dbDescribeOutputSchema>;

/** `db_query` (12 §6.11): one read-only statement. */
export const dbQueryInputSchema = z.object({
  connection: z.string().min(1).describe('Connection name from db_list_connections'),
  sql: z.string().min(1).describe("One read-only statement in the connection's dialect"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DB_QUERY_MAX_ROWS)
    .optional()
    .describe(`Rows to return, at most ${DB_QUERY_MAX_ROWS}`),
});
export type DbQueryInput = z.infer<typeof dbQueryInputSchema>;
export const dbQueryOutputSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  truncated: z.boolean(),
  elapsedMs: z.number(),
});
export type DbQueryOutput = z.infer<typeof dbQueryOutputSchema>;
