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

/** Assistant-only MCP tools (15 §3); the other assistant tools come from the operation registry. */
export const AssistantToolName = {
  GetCurrentTime: 'get_current_time',
  GetAppStatus: 'get_app_status',
  OpenPage: 'open_page',
  OpenForm: 'open_form',
  ListFiles: 'list_files',
  RevealFile: 'reveal_file',
} as const;
export type AssistantToolName = (typeof AssistantToolName)[keyof typeof AssistantToolName];

/** Pages the assistant knows the user is on and can open (14 §1); the renderer maps each to its route. */
export const AssistantPage = {
  Home: 'home',
  Tasks: 'tasks',
  Task: 'task',
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
} as const;
export type AssistantPage = (typeof AssistantPage)[keyof typeof AssistantPage];
export const assistantPageSchema = z.enum(AssistantPage);

/** Ids a page is about; on the task page `nodeId` is the selected step. */
export type AssistantPageParam = 'taskId' | 'nodeId' | 'projectId' | 'workflowKey';

/** Params each page needs to be opened. */
export const ASSISTANT_PAGE_PARAMS = {
  [AssistantPage.Home]: [],
  [AssistantPage.Tasks]: [],
  [AssistantPage.Task]: ['taskId'],
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
