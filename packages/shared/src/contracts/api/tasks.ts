import { z } from 'zod';
import {
  LIST_PAGE_DEFAULT,
  LIST_PAGE_MAX,
  REQUIREMENT_MAX_CHARS,
  TASK_TITLE_MAX_CHARS,
} from '../../constants/limits.ts';
import { worktreeStatusSchema } from '../../enums/git.ts';
import {
  AcceptanceCheckKind,
  acceptanceCheckKindSchema,
  checkUnrunnableReasonSchema,
  nodeStatusSchema,
  planSourceSchema,
  planStatusSchema,
  taskDisplayGroupSchema,
  taskEventEntitySchema,
  taskFailedPhaseSchema,
  taskStatusSchema,
} from '../../enums/task.ts';
import { nodeKindSchema, workflowDeliverableSchema, workflowPlanningSchema } from '../../enums/workflow.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
import { nodeAcceptanceSchema, planGraphSchema } from '../../workflow/plan-graph.ts';
import { diffFileSchema } from '../mcp/get-task-diff.ts';
import { submitResultInputSchema } from '../mcp/submit-result.ts';
import { reviewIssueSchema } from '../mcp/submit-review.ts';
import { attachmentIdsSchema } from './attachments.ts';
import { attemptSummarySchema } from './attempts.ts';
import { deliverySchema, taskPullRequestSchema } from './delivery.ts';
import { inboxItemSchema } from './inbox.ts';

/** Resolved once when the task is created (11 §5.1) and never changed afterwards. */
export const checkpointsSchema = z.object({
  confirm_plan: z.boolean(),
  accept_each_node: z.boolean(),
  ask_on_uncertainty: z.boolean(),
});
export type Checkpoints = z.infer<typeof checkpointsSchema>;

export const createTaskRequestSchema = z.object({
  projectId: z.string(),
  /** A specific workflow version. */
  workflowId: z.string(),
  requirement: z.string().trim().min(1).max(REQUIREMENT_MAX_CHARS),
  /** Defaults to the requirement's first line. */
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_CHARS).optional(),
  /** Defaults to the project's default branch. */
  baseBranch: z.string().min(1).optional(),
  checkpoints: checkpointsSchema.partial().optional(),
  /** Default true; false saves a draft (pro mode). */
  start: z.boolean().optional(),
  /** Files attached to the requirement (30); every step of the task sees them. */
  attachmentIds: attachmentIdsSchema.optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** A node's latest `submit_result` input as stored (10 §nodes `result`). */
export const nodeResultSchema = submitResultInputSchema;
export type NodeResult = z.infer<typeof nodeResultSchema>;

/** One acceptance check of a node's latest verification (10 §nodes `check_results`). */
export const checkResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(AcceptanceCheckKind.Command),
    command: z.string(),
    passed: z.boolean(),
    /** Combined stdout and stderr, cut to its last ACCEPTANCE_OUTPUT_MAX_CHARS characters. */
    output: z.string(),
    /** Null when the command did not exit by itself (timeout). */
    exitCode: z.number().nullable(),
    timedOut: z.boolean(),
    /** The app's environment could not run the command's program (D116); null for a check that ran. */
    unrunnable: z.object({ program: z.string(), reason: checkUnrunnableReasonSchema }).nullable().default(null),
    /** The user skipped the check after it could not run (D116): not run, does not hold the step back. */
    skipped: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal(AcceptanceCheckKind.AiReview),
    focus: z.string().nullable(),
    passed: z.boolean(),
    /** The review summary, or why the review did not complete. */
    output: z.string(),
    attemptId: z.string(),
    issues: z.array(reviewIssueSchema),
  }),
]);
export type CheckResult = z.infer<typeof checkResultSchema>;

export const nodeSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
  kind: nodeKindSchema,
  status: nodeStatusSchema,
  dependsOn: z.array(z.string()),
  /** Budget used (09 §3). */
  attemptCount: z.number(),
  resultSummary: z.string().nullable(),
  position: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type NodeSummaryDTO = z.infer<typeof nodeSummarySchema>;

export const nodeDetailSchema = nodeSummarySchema.extend({
  taskId: z.string(),
  instructions: z.string(),
  acceptance: nodeAcceptanceSchema,
  result: nodeResultSchema.nullable(),
  checkResults: z.array(checkResultSchema).nullable(),
  retryFeedback: z.string().nullable(),
  commitSha: z.string().nullable(),
  /** Execute and review attempts, oldest first. */
  attempts: z.array(attemptSummarySchema),
});
export type NodeDetailDTO = z.infer<typeof nodeDetailSchema>;

export const planSummarySchema = z.object({
  id: z.string(),
  version: z.number(),
  status: planStatusSchema,
  source: planSourceSchema,
  summary: z.string().nullable(),
  assumptions: z.array(z.string()),
  /** The user feedback this version answers (re-planning). */
  feedback: z.string().nullable(),
  createdAt: z.number(),
  confirmedAt: z.number().nullable(),
});
export type PlanSummaryDTO = z.infer<typeof planSummarySchema>;

export const planSchema = planSummarySchema.extend({ graph: planGraphSchema });
export type PlanDTO = z.infer<typeof planSchema>;

/** `PUT /tasks/:id/plan/draft` (11 §6): a user-edited plan, based on the task's latest plan version. */
export const saveDraftPlanRequestSchema = z.object({
  id: z.string(),
  baseVersion: z.number().int().min(1),
  graph: planGraphSchema,
});
export type SaveDraftPlanRequest = z.infer<typeof saveDraftPlanRequestSchema>;

/** Result card data, written when the task reaches review (M3-10). */
export const taskResultSchema = z.object({
  /** Composed from the node summaries; for report workflows, the report itself. */
  summary: z.string(),
  filesChanged: z.number(),
  insertions: z.number(),
  deletions: z.number(),
  files: z.array(diffFileSchema),
  checks: z.array(
    z.object({
      nodeKey: z.string(),
      nodeTitle: z.string(),
      kind: acceptanceCheckKindSchema,
      passed: z.boolean(),
      /** A command check's command (results written before D116 have none). */
      command: z.string().nullable().default(null),
      /** Skipped by the user, so not verified (D116). */
      skipped: z.boolean().default(false),
    }),
  ),
  nodeSummaries: z.array(z.object({ key: z.string(), title: z.string(), summary: z.string() })),
  /** Assumptions made without asking: plan, node results and questions the model answered itself. */
  assumptions: z.array(z.string()),
});
export type TaskResultDTO = z.infer<typeof taskResultSchema>;

export const taskSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  displayGroup: taskDisplayGroupSchema,
  project: z.object({ id: z.string(), name: z.string() }),
  workflow: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  /** Titles of the steps in progress, joined; null when none. */
  currentStep: z.string().nullable(),
  /** Latest `report_progress` line of an active attempt (D41). */
  progress: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type TaskSummaryDTO = z.infer<typeof taskSummarySchema>;

/** `TaskDetailDTO` (11 §5.2). */
export const taskDetailSchema = taskSummarySchema.extend({
  requirement: z.string(),
  failedPhase: taskFailedPhaseSchema.nullable(),
  failure: errorInfoSchema.nullable(),
  workflow: z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    version: z.number(),
    planning: workflowPlanningSchema,
    deliverable: workflowDeliverableSchema,
  }),
  checkpoints: checkpointsSchema,
  git: z.object({
    baseBranch: z.string(),
    baseCommit: z.string().nullable(),
    branch: z.string().nullable(),
    worktreePath: z.string().nullable(),
    worktreeStatus: worktreeStatusSchema.nullable(),
  }),
  /** The confirmed plan; while `plan_review`, the draft waiting for confirmation. */
  plan: planSchema.nullable(),
  /** While `paused`: the adjusted plan waiting for confirmation (M5-02). */
  draftPlan: planSchema.nullable(),
  nodes: z.array(nodeSummarySchema),
  activeAttempts: z.array(attemptSummarySchema),
  openInbox: z.array(inboxItemSchema),
  result: taskResultSchema.nullable(),
  /** The latest merge or pull request (M4). */
  lastDelivery: deliverySchema.nullable(),
  /** The pull request the task was delivered as, if any; it stays across review rounds (21 §5). */
  pullRequest: taskPullRequestSchema.nullable(),
});
export type TaskDetailDTO = z.infer<typeof taskDetailSchema>;

/** Opaque to clients: where the previous page ended (`<updatedAt>.<seq>` of its last task). */
export const taskCursorSchema = z.string().regex(/^\d+\.\d+$/);

export const listTasksQuerySchema = z.object({
  projectId: z.string().optional(),
  status: taskStatusSchema.optional(),
  displayGroup: taskDisplayGroupSchema.optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).default(LIST_PAGE_DEFAULT),
  cursor: taskCursorSchema.optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** One `task_events` row (10 §task_events). */
export const taskEventSchema = z.object({
  id: z.number(),
  entity: taskEventEntitySchema,
  entityId: z.string(),
  type: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.number(),
});
export type TaskEventDTO = z.infer<typeof taskEventSchema>;
