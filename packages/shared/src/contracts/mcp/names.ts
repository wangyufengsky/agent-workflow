import { AttemptKind } from '../../enums/task.ts';

/** Execution MCP tools (12 §6); opencode shows them as `agent-workflow_<name>`. */
export const McpToolName = {
  GetTaskContext: 'get_task_context',
  GetNodeOutput: 'get_node_output',
  GetTaskDiff: 'get_task_diff',
  SubmitPlan: 'submit_plan',
  SubmitResult: 'submit_result',
  SubmitReview: 'submit_review',
  AskUser: 'ask_user',
  ReportProgress: 'report_progress',
  DbListConnections: 'db_list_connections',
  DbDescribe: 'db_describe',
  DbQuery: 'db_query',
} as const;
export type McpToolName = (typeof McpToolName)[keyof typeof McpToolName];

/** The tool whose successful call finishes each kind of attempt (09 §4 `submitted`). */
export const ATTEMPT_SUBMIT_TOOL = {
  [AttemptKind.Plan]: McpToolName.SubmitPlan,
  [AttemptKind.Execute]: McpToolName.SubmitResult,
  [AttemptKind.Review]: McpToolName.SubmitReview,
} as const satisfies Record<AttemptKind, McpToolName>;
