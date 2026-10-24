import {
  AttemptKind,
  ErrorCode,
  McpToolName,
  submitBreakdownInputSchema,
  submitBreakdownOutputSchema,
} from '@aw/shared';
import type { InitiativesService } from '../../initiatives/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitBreakdownTool = (initiatives: InitiativesService) =>
  defineMcpTool({
    name: McpToolName.SubmitBreakdown,
    description:
      'Submit the breakdown of the requirement: title, summary, your understanding, the phases (the user merges at the end of each), the work packages (each one task of an allowed workflow) and the coverage table. Call it once with the whole breakdown; it is not done until it succeeds.',
    allowedKinds: [AttemptKind.Breakdown],
    input: submitBreakdownInputSchema,
    output: submitBreakdownOutputSchema,
    hints: {
      [ErrorCode.InitiativeBreakdownInvalid]:
        'Fix every problem in details.problems (each names its code and work package) and call submit_breakdown again with the whole breakdown.',
    },
    handler: (input, { attempt }) => {
      initiatives.submitBreakdown(attempt, input);
      return { accepted: true as const };
    },
  });
