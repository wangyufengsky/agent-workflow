import { z } from 'zod';

/** `assistant_confirmations.status` (09 §10): a write or critical call waits for the user (15 §4). */
export const AssistantConfirmationStatus = {
  Pending: 'pending',
  Confirmed: 'confirmed',
  Cancelled: 'cancelled',
} as const;
export type AssistantConfirmationStatus =
  (typeof AssistantConfirmationStatus)[keyof typeof AssistantConfirmationStatus];
export const assistantConfirmationStatusSchema = z.enum(AssistantConfirmationStatus);

/** 一次助手消息的执行结果；不把中断或用量缺失当作正常完成。 */
export const AssistantTurnStatus = {
  Running: 'running',
  Completed: 'completed',
  Aborted: 'aborted',
  Failed: 'failed',
  Interrupted: 'interrupted',
  TimedOut: 'timed_out',
} as const;
export type AssistantTurnStatus = (typeof AssistantTurnStatus)[keyof typeof AssistantTurnStatus];
export const assistantTurnStatusSchema = z.enum(AssistantTurnStatus);

export const AssistantTurnEvent = {
  Idle: 'idle',
  Abort: 'abort',
  Error: 'error',
  RuntimeLost: 'runtime_lost',
  BackendRestart: 'backend_restart',
  Timeout: 'timeout',
} as const;
export type AssistantTurnEvent = (typeof AssistantTurnEvent)[keyof typeof AssistantTurnEvent];
export const assistantTurnEventSchema = z.enum(AssistantTurnEvent);

/** Assistant-only MCP tools (15 §3); the other assistant tools come from the operation registry. */
export const AssistantToolName = {
  GetCurrentTime: 'get_current_time',
  GetAppStatus: 'get_app_status',
  OpenPage: 'open_page',
  OpenForm: 'open_form',
  ListFiles: 'list_files',
  RevealFile: 'reveal_file',
  /** More of a file the user attached in this conversation (30 §3.2). */
  ReadAttachment: 'read_attachment',
  ReadBrowser: 'browser_read',
  /** A bar, line or pie chart in the conversation (35 §3.1). */
  ShowChart: 'show_chart',
  /** A flowchart in the conversation (35 §3.2). */
  ShowFlowchart: 'show_flowchart',
  /** Export a finished PPT the way its「导出」buttons do (28 §4). */
  ExportDeck: 'export_deck',
} as const;
export type AssistantToolName = (typeof AssistantToolName)[keyof typeof AssistantToolName];

/** Pages the assistant knows the user is on and can open (14 §1); the renderer maps each to its route. */
export const AssistantPage = {
  Home: 'home',
  Desktop: 'desktop',
  Tasks: 'tasks',
  Task: 'task',
  /** The task page's preview tab (29 §2.6, §8.1): the user's own preview of the task. */
  TaskPreview: 'task_preview',
  Node: 'node',
  Inbox: 'inbox',
  Projects: 'projects',
  Project: 'project',
  Settings: 'settings',
  Git: 'git',
  GitProject: 'git_project',
  Workflows: 'workflows',
  Workflow: 'workflow',
  Roles: 'roles',
  Databases: 'databases',
  Tools: 'tools',
  Runtime: 'runtime',
  Knowledge: 'knowledge',
  KnowledgeConversation: 'knowledge_conversation',
  KnowledgeHistory: 'knowledge_history',
  Insights: 'insights',
  /** The team page of a project and one member of it (33 §5). */
  Team: 'team',
  TeamMember: 'team_member',
  /** PPT (23 §2): the list and one PPT's workspace. */
  Ppt: 'ppt',
  PptDeck: 'ppt_deck',
  /** Batches (20), scheduled tasks (22) and the environment checks (14 §3.1a), D111. */
  Batches: 'batches',
  Batch: 'batch',
  Schedules: 'schedules',
  Schedule: 'schedule',
  Environment: 'environment',
  /** Initiatives (34 §10): the list and one initiative. */
  Initiatives: 'initiatives',
  Initiative: 'initiative',
} as const;
export type AssistantPage = (typeof AssistantPage)[keyof typeof AssistantPage];
export const assistantPageSchema = z.enum(AssistantPage);

/** Ids a page is about; on the task page `nodeId` is the selected step. */
export type AssistantPageParam =
  | 'taskId'
  | 'nodeId'
  | 'projectId'
  | 'workflowKey'
  | 'knowledgeConversationId'
  | 'deckId'
  | 'slideId'
  | 'batchId'
  | 'scheduleId'
  | 'initiativeId'
  /** A team member's main email (33 §5.1). */
  | 'teamMember';

/** Params each page needs to be opened. */
export const ASSISTANT_PAGE_PARAMS = {
  [AssistantPage.Home]: [],
  [AssistantPage.Desktop]: [],
  [AssistantPage.Tasks]: [],
  [AssistantPage.Task]: ['taskId'],
  [AssistantPage.TaskPreview]: ['taskId'],
  [AssistantPage.Node]: ['taskId', 'nodeId'],
  [AssistantPage.Inbox]: [],
  [AssistantPage.Projects]: [],
  [AssistantPage.Project]: ['projectId'],
  [AssistantPage.Settings]: [],
  [AssistantPage.Git]: [],
  [AssistantPage.GitProject]: ['projectId'],
  [AssistantPage.Workflows]: [],
  [AssistantPage.Workflow]: ['workflowKey'],
  [AssistantPage.Roles]: [],
  [AssistantPage.Databases]: [],
  [AssistantPage.Tools]: [],
  [AssistantPage.Runtime]: [],
  [AssistantPage.Knowledge]: [],
  [AssistantPage.KnowledgeConversation]: ['knowledgeConversationId'],
  [AssistantPage.KnowledgeHistory]: [],
  [AssistantPage.Insights]: [],
  [AssistantPage.Team]: ['projectId'],
  [AssistantPage.TeamMember]: ['projectId', 'teamMember'],
  [AssistantPage.Ppt]: [],
  [AssistantPage.PptDeck]: ['deckId'],
  [AssistantPage.Batches]: [],
  [AssistantPage.Batch]: ['batchId'],
  [AssistantPage.Schedules]: [],
  [AssistantPage.Schedule]: ['scheduleId'],
  [AssistantPage.Environment]: [],
  [AssistantPage.Initiatives]: [],
  [AssistantPage.Initiative]: ['initiativeId'],
} as const satisfies Record<AssistantPage, readonly AssistantPageParam[]>;

/**
 * Forms `open_form` can open prefilled (15 §5), named by the operation they submit: credential fields of these
 * operations are typed by the user in the form, never by the assistant.
 */
export const AssistantForm = {
  StartTask: 'tasks.create',
  AddProject: 'projects.create',
  ProjectHosting: 'projects.setHosting',
  AddDbConnection: 'databases.create',
  EditDbConnection: 'databases.update',
} as const;
export type AssistantForm = (typeof AssistantForm)[keyof typeof AssistantForm];
export const assistantFormSchema = z.enum(AssistantForm);

/** What a chart in an assistant conversation draws (35, D138); `flow` comes from `show_flowchart`. */
export const ChartType = {
  Bar: 'bar',
  Line: 'line',
  Pie: 'pie',
  Flow: 'flow',
} as const;
export type ChartType = (typeof ChartType)[keyof typeof ChartType];

/** A flowchart node's shape (35 §3.2). */
export const FlowNodeShape = {
  Step: 'step',
  Decision: 'decision',
  Terminal: 'terminal',
} as const;
export type FlowNodeShape = (typeof FlowNodeShape)[keyof typeof FlowNodeShape];
export const flowNodeShapeSchema = z.enum(FlowNodeShape);
