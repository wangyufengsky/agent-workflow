import { AttemptKind, ErrorCode, McpToolName, recallInputSchema, recallOutputSchema } from '@aw/shared';
import type { AttemptsService } from '../../attempts/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const recallTool = (attempts: AttemptsService) =>
  defineMcpTool({
    name: McpToolName.Recall,
    description:
      'Read a page of original tool output using the messageId and partId from a folded reference. Continue at nextOffset.',
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review],
    input: recallInputSchema,
    output: recallOutputSchema,
    hints: {
      [ErrorCode.NotFound]: 'Use the messageId and partId of a completed text tool result in the current session.',
    },
    handler: (input, { attempt, signal }) => attempts.recall(attempt, input, signal),
  });
