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
  readOnlyStatementGroups,
} from '@aw/shared';
import type { KnowledgeService } from '../../knowledge/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

const ALL_KINDS = [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review, AttemptKind.Research];
const UNKNOWN_CONNECTION_HINT = 'Call db_list_connections and use one of the names it returns.';
/** Unattended runs (schedules, batches) must not end quietly without the database (D178). */
const LOCKED_HINT =
  'The database password is protected by the master password, which the user has not entered since the app started. If you can call ask_user, ask the user to unlock it in the app (the bar at the top of the window) and call this tool again after the answer; otherwise continue without the database and say in your result that its password was locked.';

export const dbListConnectionsTool = (tasks: TasksService, knowledge: KnowledgeService) =>
  defineMcpTool({
    name: McpToolName.DbListConnections,
    description:
      'List the databases of the project that you may query read-only, with their type (mysql, goldendb, postgresql, opengauss, sqlserver): write SQL in that dialect.',
    allowedKinds: ALL_KINDS,
    input: dbListConnectionsInputSchema,
    output: dbListConnectionsOutputSchema,
    handler: (_input, { attempt }) =>
      attempt.kind === AttemptKind.Research ? knowledge.dbConnections(attempt) : tasks.dbConnections(attempt),
  });

export const dbDescribeTool = (tasks: TasksService, knowledge: KnowledgeService) =>
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
      [ErrorCode.CredentialLocked]: LOCKED_HINT,
    },
    handler: ({ connection, table }, { attempt }) =>
      attempt.kind === AttemptKind.Research
        ? knowledge.dbDescribe(attempt, connection, table)
        : tasks.dbDescribe(attempt, connection, table),
  });

export const dbQueryTool = (tasks: TasksService, knowledge: KnowledgeService) =>
  defineMcpTool({
    name: McpToolName.DbQuery,
    description: `Run one read-only SQL statement in the connection's dialect and get at most \`limit\` rows back. Allowed statements by type: ${readOnlyStatementGroups()
      .map((g) => `${g.types.join(', ')}: ${g.statements.join(', ')}`)
      .join('; ')}.`,
    allowedKinds: ALL_KINDS,
    input: dbQueryInputSchema,
    output: dbQueryOutputSchema,
    hints: {
      [ErrorCode.DbConnectionNotFound]: UNKNOWN_CONNECTION_HINT,
      [ErrorCode.DbQueryRejected]:
        'Only one read-only statement is allowed (the message lists what this database accepts), without INTO, locking clauses or anything that writes.',
      [ErrorCode.DbQueryTimeout]: 'Narrow the query (WHERE, LIMIT, indexed columns) and try again.',
      [ErrorCode.DbQueryFailed]: 'Fix the SQL using details.driverMessage; db_describe shows the table structure.',
      [ErrorCode.DbConnectionFailed]: 'The database cannot be reached; continue without it and say so in your result.',
      [ErrorCode.CredentialLocked]: LOCKED_HINT,
    },
    handler: (input, { attempt }) =>
      attempt.kind === AttemptKind.Research ? knowledge.dbQuery(attempt, input) : tasks.dbQuery(attempt, input),
  });
