import { z } from 'zod';
import { WorkflowKind } from '../../enums/workflow.ts';
import { gitFindingSchema, submitFindingsInputSchema } from './git.ts';

export const CODE_REVIEW_WORKFLOW_KEY = 'code_review';
export const TASK_CODE_REVIEW_NODE_KEY = 'review';
export const isTaskCodeReview = (workflow: { key: string; kind: WorkflowKind }): boolean =>
  workflow.kind === WorkflowKind.Builtin && workflow.key === CODE_REVIEW_WORKFLOW_KEY;

const commitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

export const taskCodeReviewScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diff'), from: commitSha, to: commitSha }),
  z.object({ kind: z.literal('files'), commit: commitSha, directory: z.string() }),
]);

export const taskCodeReviewInputSchema = z.object({
  scope: taskCodeReviewScopeSchema,
  findings: submitFindingsInputSchema.shape.findings,
});
export type TaskCodeReviewInput = z.infer<typeof taskCodeReviewInputSchema>;

export const taskCodeReviewReportSchema = z.object({
  scope: taskCodeReviewScopeSchema,
  findings: z.array(
    gitFindingSchema.extend({
      location: z.object({ commit: commitSha, path: z.string() }),
    }),
  ),
});
export type TaskCodeReviewReport = z.infer<typeof taskCodeReviewReportSchema>;
