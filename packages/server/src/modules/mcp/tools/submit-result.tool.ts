import { AttemptKind, McpToolName, submitResultInputSchema, submitResultOutputSchema } from '@aw/shared';
import type { DebugService } from '../../debug/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitResultTool = (debug: DebugService) =>
  defineMcpTool({
    name: McpToolName.SubmitResult,
    description:
      'Submit the result of your step once the work is done and checked. Call it exactly once; the step is not finished until it succeeds.',
    allowedKinds: [AttemptKind.Execute],
    input: submitResultInputSchema,
    output: submitResultOutputSchema,
    // TODO(M3-06): node attempts write the node result and move the node to acceptance.
    handler: (input, { attempt }) => debug.submitResult(attempt, input),
  });
