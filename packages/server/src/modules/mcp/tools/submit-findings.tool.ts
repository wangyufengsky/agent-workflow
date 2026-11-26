import { AttemptKind, ErrorCode, McpToolName, submitFindingsInputSchema } from '@aw/shared';
import { z } from 'zod';
import type { GitReviewsService } from '../../git-reviews/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitFindingsTool = (reviews: GitReviewsService) =>
  defineMcpTool({
    name: McpToolName.SubmitFindings,
    description:
      'Submit the review conclusion, code findings, business impacts and regression checks. Only a direct endpoint comparison accepts comparison, with the endpoint matches, verified module and transaction changes, and business summary.',
    allowedKinds: [AttemptKind.GitReview],
    input: submitFindingsInputSchema,
    output: z.object({ accepted: z.literal(true) }),
    hints: {
      [ErrorCode.GitReviewFindingsInvalid]:
        'Fix every problem in details.problems (each names the finding by index and has its own hint) and call submit_findings again with all findings.',
    },
    handler: async (input, { attempt }) => {
      await reviews.submitFindings(attempt, input);
      return { accepted: true as const };
    },
  });
