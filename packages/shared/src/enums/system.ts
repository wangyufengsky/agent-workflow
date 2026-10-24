import { z } from 'zod';

export const RuntimeStatus = {
  NotInstalled: 'not_installed',
  VersionMismatch: 'version_mismatch',
  Stopped: 'stopped',
  Starting: 'starting',
  Ready: 'ready',
  Crashed: 'crashed',
} as const;
export type RuntimeStatus = (typeof RuntimeStatus)[keyof typeof RuntimeStatus];
export const runtimeStatusSchema = z.enum(RuntimeStatus);

/** Operating system the app runs on (`process.platform` values, 17 §1). */
export const Platform = {
  Darwin: 'darwin',
  Win32: 'win32',
  Linux: 'linux',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];
export const platformSchema = z.enum(Platform);

/** Project database engines (24 §1): GoldenDB speaks the MySQL protocol, openGauss covers GaussDB. */
export const DbType = {
  Mysql: 'mysql',
  Postgresql: 'postgresql',
  Opengauss: 'opengauss',
  Sqlserver: 'sqlserver',
  Goldendb: 'goldendb',
} as const;
export type DbType = (typeof DbType)[keyof typeof DbType];
export const dbTypeSchema = z.enum(DbType);

export const CredentialKind = {
  GitToken: 'git_token',
  DbPassword: 'db_password',
} as const;
export type CredentialKind = (typeof CredentialKind)[keyof typeof CredentialKind];
export const credentialKindSchema = z.enum(CredentialKind);

export const TranscriptEntryKind = {
  UserMessage: 'user_message',
  Text: 'text',
  Reasoning: 'reasoning',
  ToolCall: 'tool_call',
  ToolResult: 'tool_result',
  FileEdit: 'file_edit',
  Permission: 'permission',
  System: 'system',
  Error: 'error',
  /** Assistant conversations only: a call waiting for the user's confirmation (15 §4). */
  Confirmation: 'confirmation',
  /** Assistant conversations only: a file the assistant wrote in the conversation's files directory (15 §6). */
  Attachment: 'attachment',
  /** Assistant conversations only: an object an operation produced, shown as a navigation card (D66). */
  EntityRef: 'entity_ref',
} as const;
export type TranscriptEntryKind = (typeof TranscriptEntryKind)[keyof typeof TranscriptEntryKind];
export const transcriptEntryKindSchema = z.enum(TranscriptEntryKind);

/** What a `system` transcript entry records; the renderer words it (web/src/copy). */
export const TranscriptSystemEvent = {
  AttemptStarted: 'attempt_started',
  /** Idle without a result: the nudge prompt was sent (12 §4.2). */
  Nudged: 'nudged',
  /** opencode waits before retrying a failed model request; `detail` is its message. */
  Retrying: 'retrying',
  ResultSubmitted: 'result_submitted',
  /** Waiting for the user: an open blocking question or a permission request (12 §4.2). */
  AwaitingInput: 'awaiting_input',
  TimedOut: 'timed_out',
  Aborted: 'aborted',
  RuntimeLost: 'runtime_lost',
  AssistantIsolated: 'assistant_isolated',
} as const;
export type TranscriptSystemEvent = (typeof TranscriptSystemEvent)[keyof typeof TranscriptSystemEvent];
export const transcriptSystemEventSchema = z.enum(TranscriptSystemEvent);

export const BashPolicy = {
  Auto: 'auto',
  Ask: 'ask',
} as const;
export type BashPolicy = (typeof BashPolicy)[keyof typeof BashPolicy];
export const bashPolicySchema = z.enum(BashPolicy);

/** Operation risk level; decides how the v1.1 assistant confirms a call (15 §4). */
export const OperationRisk = {
  Read: 'read',
  Write: 'write',
  Critical: 'critical',
} as const;
export type OperationRisk = (typeof OperationRisk)[keyof typeof OperationRisk];
export const operationRiskSchema = z.enum(OperationRisk);

/** SSE event types (11 §11). */
export const ServerEventType = {
  TaskUpdated: 'task.updated',
  NodeUpdated: 'node.updated',
  PlanUpdated: 'plan.updated',
  AttemptUpdated: 'attempt.updated',
  AttemptTranscript: 'attempt.transcript',
  InboxUpdated: 'inbox.updated',
  DeliveryUpdated: 'delivery.updated',
  RuntimeUpdated: 'runtime.updated',
  SettingsUpdated: 'settings.updated',
  AssistantUpdated: 'assistant.updated',
  AssistantTranscript: 'assistant.transcript',
  AssistantConfirmation: 'assistant.confirmation',
  /** The assistant asks the renderer to open a page, a prefilled form, or reveal a file (15 §3). */
  AssistantNavigate: 'assistant.navigate',
  AssistantOpenForm: 'assistant.open_form',
  AssistantRevealFile: 'assistant.reveal_file',
  /** A knowledge conversation changed: a new turn, a submitted answer, a turn that ended, a deletion (18 §4). */
  KnowledgeUpdated: 'knowledge.updated',
  /** A PPT changed: AI work started or ended, a page was submitted, edited, moved or deleted (23 §8). */
  DeckUpdated: 'deck.updated',
  /** A Git workbench review started, submitted its findings or ended (27 §7.4). */
  GitReviewUpdated: 'git_review.updated',
  /** Reading a project's commits for the team page made progress or finished (33 §7.2). */
  TeamScanUpdated: 'team.scan_updated',
  /** A schedule was created, changed, ran or was deleted (22 §9). */
  ScheduleUpdated: 'schedule.updated',
  /** A task's page preview changed state (29 §4.2). */
  PreviewUpdated: 'preview.updated',
  /** An AI browser action left a frame (29 §8.2). */
  BrowserFrame: 'browser.frame',
  /** The user's preview tab changed page, viewport or error counts (29 §8.1). */
  BrowserTabUpdated: 'browser.tab_updated',
  Resync: 'resync',
} as const;
export type ServerEventType = (typeof ServerEventType)[keyof typeof ServerEventType];
export const serverEventTypeSchema = z.enum(ServerEventType);
