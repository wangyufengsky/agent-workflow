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

export const DbType = {
  Mysql: 'mysql',
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
} as const;
export type TranscriptEntryKind = (typeof TranscriptEntryKind)[keyof typeof TranscriptEntryKind];
export const transcriptEntryKindSchema = z.enum(TranscriptEntryKind);

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
  Resync: 'resync',
} as const;
export type ServerEventType = (typeof ServerEventType)[keyof typeof ServerEventType];
export const serverEventTypeSchema = z.enum(ServerEventType);
