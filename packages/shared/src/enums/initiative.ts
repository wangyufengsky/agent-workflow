import { z } from 'zod';

/** An initiative's display state (34 §6.2), derived from its facts and its items' tasks; never stored. */
export const InitiativeStatus = {
  /** The AI breaks the requirement down, or refines the work packages not started (34 §8). */
  BreakingDown: 'breaking_down',
  /** The first breakdown ended without phases and work packages. */
  BreakdownFailed: 'breakdown_failed',
  /** The phases and items wait for the user's confirmation (「先让我看看」, 34 §15.4). */
  DraftReady: 'draft_ready',
  /** Confirmed; some item of an opened phase is not satisfied yet. */
  InProgress: 'in_progress',
  /** Every item of the opened phases is satisfied and a later phase is not opened yet. */
  PhaseDone: 'phase_done',
  /** Every item is satisfied. */
  Done: 'done',
} as const;
export type InitiativeStatus = (typeof InitiativeStatus)[keyof typeof InitiativeStatus];
export const initiativeStatusSchema = z.enum(InitiativeStatus);

/** A work package's display state (34 §6.1), derived; `satisfied` and `dropped` count as done for its dependents. */
export const InitiativeItemStatus = {
  /** The user chose not to do it, with a reason. */
  Dropped: 'dropped',
  /** Its task merged into the initiative's base branch, finished a report, or the user confirmed the PR merged. */
  Satisfied: 'satisfied',
  /** Its task was delivered as a pull request that the user has not marked merged yet. */
  PrOpen: 'pr_open',
  /** Its task is under way (any non-terminal task state). */
  InTask: 'in_task',
  /** Its phase is not opened yet. */
  PhaseClosed: 'phase_closed',
  /** Its phase is open but an item it depends on is not satisfied. */
  Waiting: 'waiting',
  /** Can start: never started, or its task was cancelled or merged elsewhere. */
  Ready: 'ready',
} as const;
export type InitiativeItemStatus = (typeof InitiativeItemStatus)[keyof typeof InitiativeItemStatus];
export const initiativeItemStatusSchema = z.enum(InitiativeItemStatus);

/** What an AI breakdown run of an initiative does (34 §8, §9 `initiative_runs`). */
export const InitiativeRunMode = {
  /** The first breakdown, from the requirement. */
  Breakdown: 'breakdown',
  /** A new breakdown of the draft with the user's feedback. */
  Rebreakdown: 'rebreakdown',
  /** Rewrites the work packages that have not started on the merged code (D136). */
  Refine: 'refine',
} as const;
export type InitiativeRunMode = (typeof InitiativeRunMode)[keyof typeof InitiativeRunMode];
export const initiativeRunModeSchema = z.enum(InitiativeRunMode);

/** Built-in composition templates are synced with the app and read-only (34 §15.3). */
export const InitiativeTemplateKind = {
  Builtin: 'builtin',
} as const;
export type InitiativeTemplateKind = (typeof InitiativeTemplateKind)[keyof typeof InitiativeTemplateKind];
export const initiativeTemplateKindSchema = z.enum(InitiativeTemplateKind);
