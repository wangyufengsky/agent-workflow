import { z } from 'zod';
import {
  INITIATIVE_INSTRUCTION_MAX_CHARS,
  INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS,
  INITIATIVE_ITEMS_MAX,
  INITIATIVE_PHASE_GOAL_MAX_CHARS,
  INITIATIVE_PHASE_TITLE_MAX_CHARS,
  INITIATIVE_PHASES_MAX,
  INITIATIVE_REASON_MAX_CHARS,
  INITIATIVE_SOURCES_MAX,
  INITIATIVE_TITLE_MAX_CHARS,
  LIST_PAGE_DEFAULT,
  LIST_PAGE_MAX,
  REQUIREMENT_MAX_CHARS,
  REQUIREMENTS_MAX,
} from '../../constants/limits.ts';
import { batchDeliveryOutcomeSchema } from '../../enums/batch.ts';
import { localMergeStrategySchema } from '../../enums/git.ts';
import {
  initiativeItemStatusSchema,
  initiativeRunModeSchema,
  initiativeStatusSchema,
  initiativeTemplateKindSchema,
} from '../../enums/initiative.ts';
import { attemptStatusSchema } from '../../enums/task.ts';
import { workflowDeliverableSchema } from '../../enums/workflow.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
import { NODE_KEY_PATTERN } from '../../workflow/plan-graph.ts';
import { initiativeCoverageSchema, initiativeUnderstandingSchema } from '../mcp/submit-breakdown.ts';
import { attachmentSchema } from './attachments.ts';
import { deliverySchema } from './delivery.ts';
import { requirementItemInputSchema } from './requirements.ts';
import { taskSummarySchema } from './tasks.ts';
import { DEFINITION_KEY_PATTERN } from './workflows.ts';

/** One phase (34 §5.3, §15.5): opened in order; `autoOpen` opens it once every earlier work package is satisfied. */
export const initiativePhaseSchema = z.object({
  title: z.string().trim().min(1).max(INITIATIVE_PHASE_TITLE_MAX_CHARS),
  goal: z.string().trim().max(INITIATIVE_PHASE_GOAL_MAX_CHARS).default(''),
  autoOpen: z.boolean().default(false),
});
export type InitiativePhase = z.output<typeof initiativePhaseSchema>;

/** One work package as the user, a template or the AI writes it; at run time it is one ordinary task (34 §2). */
export const initiativeItemSpecSchema = z.object({
  key: z.string().regex(NODE_KEY_PATTERN),
  title: z.string().trim().min(1).max(INITIATIVE_TITLE_MAX_CHARS),
  /** 1-based, into `phases`. */
  phase: z.number().int().min(1),
  /** The key of the workflow its task runs (the latest version when it starts). */
  workflow: z.string().regex(DEFINITION_KEY_PATTERN),
  /** The task's requirement. */
  requirement: z.string().trim().min(1).max(INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS),
  dependsOn: z.array(z.string()).default([]),
  /** The task's acceptance checklist (31); none when empty. */
  acceptance: z.array(requirementItemInputSchema).max(REQUIREMENTS_MAX).default([]),
});
export type InitiativeItemSpec = z.output<typeof initiativeItemSpecSchema>;

/** Phases and work packages: what a template defines and what the user edits before and after confirming. */
export const initiativeDraftSchema = z.object({
  phases: z.array(initiativePhaseSchema).min(1).max(INITIATIVE_PHASES_MAX),
  items: z.array(initiativeItemSpecSchema).min(1).max(INITIATIVE_ITEMS_MAX),
});
export type InitiativeDraft = z.output<typeof initiativeDraftSchema>;

/** A composition template (34 §15.2): requirements may contain `{{requirement}}`, the user's requirement. */
export const initiativeTemplateSchema = initiativeDraftSchema.extend({
  key: z.string().regex(DEFINITION_KEY_PATTERN),
  kind: initiativeTemplateKindSchema,
  name: z.string().min(1).max(40),
  description: z.string().min(1).max(200),
});
export type InitiativeTemplateDTO = z.output<typeof initiativeTemplateSchema>;

/**
 * `POST /initiatives`: from a composition template (34 §15.4), or — without `templateKey` — broken down by the AI
 * into a draft for the user to confirm (34 §5.1, D133).
 */
export const createInitiativeRequestSchema = z.object({
  projectId: z.string(),
  templateKey: z.string().regex(DEFINITION_KEY_PATTERN).optional(),
  /** The workflows the AI may give work packages (AI breakdown only); default: every listed workflow. */
  allowedWorkflows: z.array(z.string().regex(DEFINITION_KEY_PATTERN)).min(1).optional(),
  requirement: z.string().trim().min(1).max(REQUIREMENT_MAX_CHARS),
  attachmentIds: z.array(z.string()).max(INITIATIVE_SOURCES_MAX).optional(),
  /** Defaults to the project's default branch; every work package branches from it and merges back into it. */
  baseBranch: z.string().min(1).optional(),
  /** 「先让我看看」: stop at the draft instead of starting the first phase (templates; a breakdown always stops). */
  review: z.boolean().default(false),
  /** 「每个工作包运行前让我确认计划」: the tasks' `confirm_plan`. */
  confirmItemPlans: z.boolean().default(false),
});
export type CreateInitiativeRequest = z.input<typeof createInitiativeRequestSchema>;

export const listInitiativesQuerySchema = z.object({
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).default(LIST_PAGE_DEFAULT),
  /** The `seq` of the previous page's last initiative. */
  cursor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});
export type ListInitiativesQuery = z.infer<typeof listInitiativesQuerySchema>;

export const initiativeSummarySchema = z.object({
  id: z.string(),
  /** `I-<seq>` */
  key: z.string(),
  title: z.string(),
  project: z.object({ id: z.string(), name: z.string() }),
  /** The template it was made from; null once that template is gone. */
  template: z.object({ key: z.string(), name: z.string() }).nullable(),
  status: initiativeStatusSchema,
  phaseCount: z.number(),
  /** Phases opened so far; 0 before confirming. */
  openedPhase: z.number(),
  itemCount: z.number(),
  /** Satisfied or dropped work packages. */
  doneCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type InitiativeSummaryDTO = z.infer<typeof initiativeSummarySchema>;

export const initiativeItemSchema = initiativeItemSpecSchema.extend({
  status: initiativeItemStatusSchema,
  /** The workflow's latest version; name and deliverable are null when the workflow no longer exists. */
  workflowName: z.string().nullable(),
  deliverable: workflowDeliverableSchema.nullable(),
  /** The current task; an earlier, cancelled one stays in the task list. */
  task: taskSummarySchema.nullable(),
  lastDelivery: deliverySchema.nullable(),
  /** Why the last attempt to start its task failed; cleared when one succeeds. */
  startError: errorInfoSchema.nullable(),
  mergeConfirmedAt: z.number().nullable(),
  droppedAt: z.number().nullable(),
  dropReason: z.string().nullable(),
});
export type InitiativeItemDTO = z.infer<typeof initiativeItemSchema>;

/** One AI breakdown or refinement (34 §9 `initiative_runs`); its state is its attempt's. */
export const initiativeRunSchema = z.object({
  seq: z.number(),
  mode: initiativeRunModeSchema,
  attemptId: z.string(),
  status: attemptStatusSchema,
  instruction: z.string().nullable(),
  /** The phase confirming this run's draft opens (「进入第 k 阶段」with refinement first). */
  openPhase: z.number().nullable(),
  error: errorInfoSchema.nullable(),
  createdAt: z.number(),
});
export type InitiativeRunDTO = z.infer<typeof initiativeRunSchema>;

export const initiativeDetailSchema = initiativeSummarySchema.extend({
  requirement: z.string(),
  baseBranch: z.string(),
  confirmItemPlans: z.boolean(),
  /** null: every listed workflow. */
  allowedWorkflows: z.array(z.string()).nullable(),
  /** From the latest AI breakdown; null for an initiative made from a template and not refined since. */
  summary: z.string().nullable(),
  understanding: initiativeUnderstandingSchema.nullable(),
  coverage: z.array(initiativeCoverageSchema).nullable(),
  /** The latest breakdown or refinement, if any. */
  latestRun: initiativeRunSchema.nullable(),
  phases: z.array(initiativePhaseSchema.extend({ opened: z.boolean() })),
  /** In phase order, then in the order written. */
  items: z.array(initiativeItemSchema),
  attachments: z.array(attachmentSchema),
});
export type InitiativeDetailDTO = z.infer<typeof initiativeDetailSchema>;

const idSchema = z.object({ id: z.string() });
const itemRefSchema = z.object({ id: z.string(), key: z.string() });
const phaseRefSchema = z.object({ id: z.string(), phase: z.coerce.number().int().min(1) });
const instructionSchema = z.string().trim().min(1).max(INITIATIVE_INSTRUCTION_MAX_CHARS).optional();

export const saveInitiativeDraftRequestSchema = idSchema.extend(initiativeDraftSchema.shape);
export const getInitiativeRequestSchema = idSchema;
export const confirmInitiativeRequestSchema = idSchema;
/** `refine`: the AI rewrites the work packages not started on the merged code first; confirming opens the phase. */
export const openInitiativePhaseRequestSchema = phaseRefSchema.extend({ refine: z.boolean().default(false) });
export const rebreakdownInitiativeRequestSchema = idSchema.extend({ instruction: instructionSchema });
export const refineInitiativeRequestSchema = idSchema.extend({ instruction: instructionSchema });
export const startInitiativeItemRequestSchema = itemRefSchema;
export const confirmInitiativeItemMergedRequestSchema = itemRefSchema;
export const dropInitiativeItemRequestSchema = itemRefSchema.extend({
  reason: z.string().trim().min(1).max(INITIATIVE_REASON_MAX_CHARS),
});
export const deleteInitiativeRequestSchema = idSchema;

/** `POST /initiatives/:id/phases/:phase/deliver`: as batch delivery (20 §5), over the phase's work packages. */
export const deliverInitiativePhaseRequestSchema = phaseRefSchema.extend({
  strategy: localMergeStrategySchema.optional(),
});
export const initiativeDeliveryResultSchema = z.object({
  itemKey: z.string(),
  taskId: z.string(),
  taskKey: z.string(),
  outcome: batchDeliveryOutcomeSchema,
  error: errorInfoSchema.nullable(),
});
export type InitiativeDeliveryResultDTO = z.infer<typeof initiativeDeliveryResultSchema>;
export const deliverInitiativePhaseResponseSchema = z.object({
  initiative: initiativeDetailSchema,
  outcomes: z.array(initiativeDeliveryResultSchema),
});
export type DeliverInitiativePhaseResponse = z.infer<typeof deliverInitiativePhaseResponseSchema>;
