import { z } from 'zod';
import { AttemptStatus } from './task.ts';

/** A knowledge turn's status, derived from its research attempt (18 §3); not stored. */
export const KnowledgeTurnStatus = {
  Researching: 'researching',
  Answered: 'answered',
  Stopped: 'stopped',
  Failed: 'failed',
} as const;
export type KnowledgeTurnStatus = (typeof KnowledgeTurnStatus)[keyof typeof KnowledgeTurnStatus];
export const knowledgeTurnStatusSchema = z.enum(KnowledgeTurnStatus);

const TURN_STATUS_OF_ATTEMPT = {
  [AttemptStatus.Starting]: KnowledgeTurnStatus.Researching,
  [AttemptStatus.Running]: KnowledgeTurnStatus.Researching,
  [AttemptStatus.Succeeded]: KnowledgeTurnStatus.Answered,
  [AttemptStatus.Aborted]: KnowledgeTurnStatus.Stopped,
  [AttemptStatus.Failed]: KnowledgeTurnStatus.Failed,
  [AttemptStatus.Interrupted]: KnowledgeTurnStatus.Failed,
} as const satisfies Record<AttemptStatus, KnowledgeTurnStatus>;

export const knowledgeTurnStatusOf = (attempt: AttemptStatus): KnowledgeTurnStatus => TURN_STATUS_OF_ATTEMPT[attempt];

/** What a question may draw on (18 §2.1); `web` is the separate network switch. */
export const KnowledgeSourceKind = {
  Code: 'code',
  Docs: 'docs',
  Database: 'database',
  Web: 'web',
} as const;
export type KnowledgeSourceKind = (typeof KnowledgeSourceKind)[keyof typeof KnowledgeSourceKind];
export const knowledgeSourceKindSchema = z.enum(KnowledgeSourceKind);

/** `submit_answer` citation types (18 §6.1). */
export const CitationType = {
  File: 'file',
  Database: 'database',
  Web: 'web',
} as const;
export type CitationType = (typeof CitationType)[keyof typeof CitationType];
