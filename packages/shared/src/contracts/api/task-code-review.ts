import { z } from 'zod';
import { GIT_REVIEW_FINDINGS_MAX } from '../../constants/limits.ts';
import { WorkflowKind } from '../../enums/workflow.ts';
import { codeFindingSchema } from './git.ts';

export const CODE_REVIEW_WORKFLOW_KEY = 'code_review';
export const VERSION_REVIEW_WORKFLOW_KEY = 'version_review';
export const SECURITY_REVIEW_WORKFLOW_KEY = 'security_review';
export const DESIGN_PROPOSAL_WORKFLOW_KEY = 'design_proposal';
export const TASK_CODE_REVIEW_NODE_KEY = 'review';
export const isTaskCodeReview = (workflow: { key: string; kind: WorkflowKind }): boolean =>
  workflow.kind === WorkflowKind.Builtin &&
  [CODE_REVIEW_WORKFLOW_KEY, VERSION_REVIEW_WORKFLOW_KEY, SECURITY_REVIEW_WORKFLOW_KEY].includes(workflow.key);

export const isDesignProposalWorkflow = (workflow: { key: string; kind: WorkflowKind }) =>
  workflow.kind === WorkflowKind.Builtin && workflow.key === DESIGN_PROPOSAL_WORKFLOW_KEY;

const commitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

export const taskCodeReviewScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diff'), from: commitSha, to: commitSha }),
  z.object({ kind: z.literal('files'), commit: commitSha, directory: z.string() }),
]);

export const taskCodeReviewInputSchema = z.object({
  scope: taskCodeReviewScopeSchema,
  findings: z.array(codeFindingSchema).max(GIT_REVIEW_FINDINGS_MAX),
});
export type TaskCodeReviewInput = z.infer<typeof taskCodeReviewInputSchema>;

export const taskCodeReviewReportSchema = z.object({
  scope: taskCodeReviewScopeSchema,
  findings: z.array(
    codeFindingSchema.extend({
      location: z.object({ commit: commitSha, path: z.string() }),
    }),
  ),
});
export type TaskCodeReviewReport = z.infer<typeof taskCodeReviewReportSchema>;
