import { AttemptKind } from '../../enums/task.ts';

/** Execution MCP tools (12 §6); opencode shows them as `agent-workflow_<name>`. */
export const McpToolName = {
  GetTaskContext: 'get_task_context',
  GetNodeOutput: 'get_node_output',
  GetTaskDiff: 'get_task_diff',
  ReadAttachment: 'read_attachment',
  SubmitPlan: 'submit_plan',
  SubmitResult: 'submit_result',
  SubmitReview: 'submit_review',
  AskUser: 'ask_user',
  ReportProgress: 'report_progress',
  DbListConnections: 'db_list_connections',
  DbDescribe: 'db_describe',
  DbQuery: 'db_query',
  SubmitAnswer: 'submit_answer',
  SubmitOutline: 'submit_outline',
  SubmitSlide: 'submit_slide',
  SubmitFindings: 'submit_findings',
  SubmitCommitMessage: 'submit_commit_message',
  BrowserOpen: 'browser_open',
  BrowserSnapshot: 'browser_snapshot',
  BrowserClick: 'browser_click',
  BrowserType: 'browser_type',
  BrowserSelect: 'browser_select',
  BrowserPress: 'browser_press',
  BrowserWaitFor: 'browser_wait_for',
  BrowserInspect: 'browser_inspect',
  BrowserLogs: 'browser_logs',
  BrowserViewport: 'browser_viewport',
  BrowserScreenshot: 'browser_screenshot',
} as const;
export type McpToolName = (typeof McpToolName)[keyof typeof McpToolName];

/** The tool whose successful call finishes each kind of attempt (09 §4 `submitted`). */
export const ATTEMPT_SUBMIT_TOOL = {
  [AttemptKind.Plan]: McpToolName.SubmitPlan,
  [AttemptKind.Execute]: McpToolName.SubmitResult,
  [AttemptKind.Review]: McpToolName.SubmitReview,
  [AttemptKind.Research]: McpToolName.SubmitAnswer,
  [AttemptKind.DeckOutline]: McpToolName.SubmitOutline,
  // Called once per page; the attempt is submitted with the last of its pages (23 §4.1).
  [AttemptKind.DeckSlides]: McpToolName.SubmitSlide,
  [AttemptKind.GitReview]: McpToolName.SubmitFindings,
  [AttemptKind.CommitMessage]: McpToolName.SubmitCommitMessage,
} as const satisfies Record<AttemptKind, McpToolName>;
