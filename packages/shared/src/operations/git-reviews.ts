import { z } from 'zod';
import { gitReviewFocusSchema, gitReviewSchema, gitReviewTargetInputSchema } from '../contracts/api/git.ts';
import { EntityKind, InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// AI reviews in the Git workbench (27 §4, D109): read-only, structured findings.
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Pro } as const;

export const startGitReviewOp = defineOperationContract({
  ...common,
  id: 'gitReviews.start',
  refs: { id: InputRef.Project },
  title: 'op.gitReviews.start',
  description:
    'Let the AI review uncommitted changes, a commit, a branch or a range read-only; it reports structured findings',
  input: z.object({ id: z.string(), target: gitReviewTargetInputSchema, focus: gitReviewFocusSchema.optional() }),
  output: gitReviewSchema,
  // Starts a model session that reads the repository and uses model quota.
  risk: OperationRisk.Write,
  produces: { kind: EntityKind.GitReview, ref: (r) => ({ id: r.id, title: r.label }) },
  http: { method: 'POST', path: '/projects/:id/git/reviews', status: 201 },
});

export const listGitReviewsOp = defineOperationContract({
  ...common,
  id: 'gitReviews.list',
  title: 'op.gitReviews.list',
  description: 'AI reviews of the project, newest first; `to` limits them to reviews of that commit',
  input: z.object({ id: z.string(), to: z.string().min(1).optional() }),
  output: z.object({ items: z.array(gitReviewSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/git/reviews' },
});

export const getGitReviewOp = defineOperationContract({
  ...common,
  id: 'gitReviews.get',
  title: 'op.gitReviews.get',
  description: 'One AI review with its findings',
  input: z.object({ reviewId: z.string() }),
  output: gitReviewSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/git/reviews/:reviewId' },
});

export const stopGitReviewOp = defineOperationContract({
  ...common,
  id: 'gitReviews.stop',
  refs: { reviewId: InputRef.GitReview },
  title: 'op.gitReviews.stop',
  description: 'Stop a review that is still running',
  input: z.object({ reviewId: z.string() }),
  output: gitReviewSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/git/reviews/:reviewId/stop' },
});
