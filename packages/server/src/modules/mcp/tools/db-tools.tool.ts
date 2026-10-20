import {
  AttemptKind,
  dbDescribeInputSchema,
  dbDescribeOutputSchema,
  dbListConnectionsInputSchema,
  dbListConnectionsOutputSchema,
  dbQueryInputSchema,
  dbQueryOutputSchema,
  ErrorCode,
  McpToolName,
} from '@aw/shared';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

const ALL_KINDS = [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review];
const UNKNOWN_CONNECTION_HINT = 'Call db_list_connections and use one of the names it returns.';

export const dbListConnectionsTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.DbListConnections,
    description: "List the databases of this task's project that you may query read-only.",
    allowedKinds: ALL_KINDS,
    input: dbListConnectionsInputSchema,
    output: dbListConnectionsOutputSchema,
    handler: (_input, { attempt }) => tasks.dbConnections(attempt),
  });

export const dbDescribeTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.DbDescribe,
    description: 'List the tables of a database, or show the columns and indexes of one table.',
    allowedKinds: ALL_KINDS,
    input: dbDescribeInputSchema,
    output: dbDescribeOutputSchema,
    hints: {
      [ErrorCode.DbConnectionNotFound]: UNKNOWN_CONNECTION_HINT,
      [ErrorCode.ValidationFailed]: 'Call db_describe without table to list the tables, then pick one.',
      [ErrorCode.DbConnectionFailed]: 'The database cannot be reached; continue without it and say so in your result.',
    },
    handler: ({ connection, table }, { attempt }) => tasks.dbDescribe(attempt, connection, table),
  });

export const dbQueryTool = (tasks: TasksService) =>
  defineMcpTool({
    name: McpToolName.DbQuery,
    description:
      'Run one read-only SQL statement (SELECT, SHOW, DESCRIBE or EXPLAIN) and get at most `limit` rows back.',
    allowedKinds: ALL_KINDS,
    input: dbQueryInputSchema,
    output: dbQueryOutputSchema,
    hints: {
      [ErrorCode.DbConnectionNotFound]: UNKNOWN_CONNECTION_HINT,
      [ErrorCode.DbQueryRejected]:
        'Only one read-only statement is allowed: SELECT, SHOW, DESCRIBE or EXPLAIN, without INTO or locking clauses.',
      [ErrorCode.DbQueryTimeout]: 'Narrow the query (WHERE, LIMIT, indexed columns) and try again.',
      [ErrorCode.DbQueryFailed]: 'Fix the SQL using details.driverMessage; db_describe shows the table structure.',
      [ErrorCode.DbConnectionFailed]: 'The database cannot be reached; continue without it and say so in your result.',
    },
    handler: (input, { attempt }) => tasks.dbQuery(attempt, input),
  });
