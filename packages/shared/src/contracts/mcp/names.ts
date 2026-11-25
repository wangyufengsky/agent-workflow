import { AttemptKind } from '../../enums/task.ts';
import { NodeKind } from '../../enums/workflow.ts';

/** Execution MCP tools (12 §6); opencode shows them as `agent-workflow_<name>`. */
export const McpToolName = {
  GetSubmissionGuide: 'get_submission_guide',
  GetTaskContext: 'get_task_context',
  GetNodeOutput: 'get_node_output',
  Recall: 'recall',
  GetTaskDiff: 'get_task_diff',
  DelegateReadonly: 'delegate_readonly',
  InspectDelegation: 'inspect_delegation',
  SubmitDelegation: 'submit_delegation',
  ReadAttachment: 'read_attachment',
  AnalyzeImage: 'analyze_image',
  ProcessDocument: 'process_document',
  InvestigateDatabase: 'investigate_database',
  ReadSheet: 'read_sheet',
  QuerySheet: 'query_sheet',
  ReadOfficeFile: 'read_office_file',
  ReadTaskArtifact: 'read_task_artifact',
  WriteTaskText: 'write_task_text',
  WriteTaskDocx: 'write_task_docx',
  WriteTaskXlsx: 'write_task_xlsx',
  EditTaskXlsx: 'edit_task_xlsx',
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
  SubmitDesignOutline: 'submit_design_outline',
  SubmitDesignSection: 'submit_design_section',
  SubmitDesignReview: 'submit_design_review',
  SubmitFindings: 'submit_findings',
  SubmitCommitMessage: 'submit_commit_message',
  SubmitMemberAnalysis: 'submit_member_analysis',
  SubmitBreakdown: 'submit_breakdown',
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
  BrowserSubmitReport: 'browser_submit_report',
  TestCaseSave: 'test_case_save',
  TestCaseRun: 'test_case_run',
  TestCaseRevise: 'test_case_revise',
  TestRunRead: 'test_run_read',
  TestIdeConfigurations: 'test_ide_configurations',
  TestEnvironmentPrepare: 'test_environment_prepare',
  TestReportSubmit: 'test_report_submit',
} as const;
export type McpToolName = (typeof McpToolName)[keyof typeof McpToolName];

export const BROWSER_TEST_TOOLS = Object.values(McpToolName).filter(
  (name) =>
    (name.startsWith('browser_') && name !== McpToolName.BrowserSubmitReport) ||
    name === McpToolName.Recall ||
    name === McpToolName.AnalyzeImage ||
    name === McpToolName.GetSubmissionGuide ||
    name === McpToolName.GetTaskContext ||
    name === McpToolName.AskUser ||
    name === McpToolName.ReportProgress,
);

export type BrowserTestSubmitTool = typeof McpToolName.BrowserSubmitReport | typeof McpToolName.SubmitResult;

export function browserTestSubmitTool(kind: NodeKind): BrowserTestSubmitTool {
  return kind === NodeKind.Verify ? McpToolName.SubmitResult : McpToolName.BrowserSubmitReport;
}

/** The tool whose successful call finishes each kind of attempt (09 §4 `submitted`). */
export const ATTEMPT_SUBMIT_TOOL = {
  [AttemptKind.Plan]: McpToolName.SubmitPlan,
  [AttemptKind.Execute]: McpToolName.SubmitResult,
  [AttemptKind.Review]: McpToolName.SubmitReview,
  [AttemptKind.Research]: McpToolName.SubmitAnswer,
  [AttemptKind.DeckOutline]: McpToolName.SubmitOutline,
  // Called once per page; the attempt is submitted with the last of its pages (23 §4.1).
  [AttemptKind.DeckSlides]: McpToolName.SubmitSlide,
  [AttemptKind.DesignOutline]: McpToolName.SubmitDesignOutline,
  [AttemptKind.DesignGenerate]: McpToolName.SubmitDesignSection,
  [AttemptKind.DesignRevise]: McpToolName.SubmitDesignSection,
  [AttemptKind.DesignReview]: McpToolName.SubmitDesignReview,
  [AttemptKind.GitReview]: McpToolName.SubmitFindings,
  [AttemptKind.CommitMessage]: McpToolName.SubmitCommitMessage,
  [AttemptKind.TeamAnalysis]: McpToolName.SubmitMemberAnalysis,
  [AttemptKind.Breakdown]: McpToolName.SubmitBreakdown,
  [AttemptKind.Delegation]: McpToolName.SubmitDelegation,
} as const satisfies Record<AttemptKind, McpToolName>;

export const DESIGN_ATTEMPT_KINDS = [
  AttemptKind.DesignOutline,
  AttemptKind.DesignGenerate,
  AttemptKind.DesignRevise,
  AttemptKind.DesignReview,
] as const;

export type DesignAttemptKind = (typeof DESIGN_ATTEMPT_KINDS)[number];

export function isDesignAttemptKind(kind: AttemptKind): kind is DesignAttemptKind {
  return DESIGN_ATTEMPT_KINDS.some((candidate) => candidate === kind);
}

export const DESIGN_MCP_TOOLS: readonly McpToolName[] = [
  ...new Set(DESIGN_ATTEMPT_KINDS.map((kind) => ATTEMPT_SUBMIT_TOOL[kind])),
  McpToolName.ReportProgress,
];

export function isAttemptSubmitTool(name: McpToolName): boolean {
  return name === McpToolName.BrowserSubmitReport || Object.values(ATTEMPT_SUBMIT_TOOL).some((tool) => tool === name);
}
