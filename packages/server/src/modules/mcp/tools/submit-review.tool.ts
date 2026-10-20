import { AttemptKind, ErrorCode, McpToolName, submitReviewInputSchema, submitReviewOutputSchema } from '@aw/shared';
import type { AcceptanceService } from '../../acceptance/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitReviewTool = (acceptance: AcceptanceService) =>
  defineMcpTool({
    name: McpToolName.SubmitReview,
    description:
      'Submit your review verdict once: pass, or fail with at least one blocker or major issue, each with its location.',
    allowedKinds: [AttemptKind.Review],
    input: submitReviewInputSchema,
    output: submitReviewOutputSchema,
    hints: {
      [ErrorCode.ValidationFailed]:
        'Fix the arguments in details.issues; a fail verdict needs at least one issue of severity blocker or major.',
    },
    handler: (input, { attempt }) => acceptance.submitReview(attempt, input),
  });
