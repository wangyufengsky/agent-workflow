import { z } from 'zod';

export const TaskStatus = {
  Draft: 'draft',
  Preparing: 'preparing',
  Planning: 'planning',
  PlanReview: 'plan_review',
  Running: 'running',
  Paused: 'paused',
  Review: 'review',
  Merging: 'merging',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus);
export const taskStatusSchema = z.enum(TaskStatus);

export const TaskFailedPhase = {
  Preparing: 'preparing',
  Planning: 'planning',
  Running: 'running',
  Merging: 'merging',
} as const;
export type TaskFailedPhase = (typeof TaskFailedPhase)[keyof typeof TaskFailedPhase];
export const taskFailedPhaseSchema = z.enum(TaskFailedPhase);

export const NodeStatus = {
  Pending: 'pending',
  Ready: 'ready',
  Running: 'running',
  WaitingInput: 'waiting_input',
  Verifying: 'verifying',
  AwaitingAcceptance: 'awaiting_acceptance',
  Done: 'done',
  Failed: 'failed',
  Skipped: 'skipped',
  Cancelled: 'cancelled',
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];
export const NODE_STATUSES = Object.values(NodeStatus);
export const nodeStatusSchema = z.enum(NodeStatus);

export const AttemptKind = {
  Plan: 'plan',
  Execute: 'execute',
  Review: 'review',
  /** One question of a knowledge conversation (18 §5.2); belongs to no task. */
  Research: 'research',
  /** A PPT's outline (23 §4): the AI proposes the pages; belongs to no task. */
  DeckOutline: 'deck_outline',
  /** Makes or revises some pages of a PPT (23 §4). */
  DeckSlides: 'deck_slides',
  /** A read-only review of a diff in the Git workbench (27 §4); belongs to no task. */
  GitReview: 'git_review',
  /** Drafts a commit message from a diff (27 §7.3); belongs to no task. */
  CommitMessage: 'commit_message',
} as const;
export type AttemptKind = (typeof AttemptKind)[keyof typeof AttemptKind];
export const attemptKindSchema = z.enum(AttemptKind);

export const AttemptStatus = {
  Starting: 'starting',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Aborted: 'aborted',
  Interrupted: 'interrupted',
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];
export const ATTEMPT_STATUSES = Object.values(AttemptStatus);
export const attemptStatusSchema = z.enum(AttemptStatus);

export const PlanStatus = {
  Draft: 'draft',
  Confirmed: 'confirmed',
  Superseded: 'superseded',
} as const;
export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];
export const planStatusSchema = z.enum(PlanStatus);

export const PlanSource = {
  Ai: 'ai',
  Template: 'template',
  User: 'user',
} as const;
export type PlanSource = (typeof PlanSource)[keyof typeof PlanSource];
export const planSourceSchema = z.enum(PlanSource);

export const CheckpointKey = {
  ConfirmPlan: 'confirm_plan',
  AcceptEachNode: 'accept_each_node',
  AskOnUncertainty: 'ask_on_uncertainty',
} as const;
export type CheckpointKey = (typeof CheckpointKey)[keyof typeof CheckpointKey];
export const checkpointKeySchema = z.enum(CheckpointKey);

export const AcceptanceCheckKind = {
  Command: 'command',
  /** The page check (29 §7): the task's key pages opened in the browser, judged by facts, without a model. */
  Browser: 'browser',
  AiReview: 'ai_review',
} as const;
export type AcceptanceCheckKind = (typeof AcceptanceCheckKind)[keyof typeof AcceptanceCheckKind];
export const acceptanceCheckKindSchema = z.enum(AcceptanceCheckKind);

/** Why a check command could not run in the app's environment (D116): its program is missing or not executable. */
export const CheckUnrunnableReason = {
  NotFound: 'not_found',
  NotExecutable: 'not_executable',
} as const;
export type CheckUnrunnableReason = (typeof CheckUnrunnableReason)[keyof typeof CheckUnrunnableReason];
export const checkUnrunnableReasonSchema = z.enum(CheckUnrunnableReason);

/** What the simple-mode UI shows for a task; derived by `resolveTaskDisplayGroup`. */
export const TaskDisplayGroup = {
  Preparing: 'preparing',
  PlanReview: 'plan_review',
  Running: 'running',
  Paused: 'paused',
  NeedsAttention: 'needs_attention',
  Review: 'review',
  Merging: 'merging',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;
export type TaskDisplayGroup = (typeof TaskDisplayGroup)[keyof typeof TaskDisplayGroup];
export const TASK_DISPLAY_GROUPS = Object.values(TaskDisplayGroup);
export const taskDisplayGroupSchema = z.enum(TaskDisplayGroup);

/** What a `task_events` row is about (10 §task_events). */
export const TaskEventEntity = {
  Task: 'task',
  Node: 'node',
  Attempt: 'attempt',
  Plan: 'plan',
  Delivery: 'delivery',
} as const;
export type TaskEventEntity = (typeof TaskEventEntity)[keyof typeof TaskEventEntity];
export const taskEventEntitySchema = z.enum(TaskEventEntity);
