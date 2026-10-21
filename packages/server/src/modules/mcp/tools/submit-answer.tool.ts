import { AttemptKind, ErrorCode, McpToolName, submitAnswerInputSchema, submitAnswerOutputSchema } from '@aw/shared';
import type { KnowledgeService } from '../../knowledge/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitAnswerTool = (knowledge: KnowledgeService) =>
  defineMcpTool({
    name: McpToolName.SubmitAnswer,
    description:
      'Submit your answer to the question with its citations. Call it exactly once; the question is not answered until it succeeds.',
    allowedKinds: [AttemptKind.Research],
    input: submitAnswerInputSchema,
    output: submitAnswerOutputSchema,
    hints: {
      [ErrorCode.KnowledgeCitationInvalid]:
        'Fix every problem in details.problems (each has its own hint) and call submit_answer again with the whole answer.',
    },
    handler: async (input, { attempt }) => {
      await knowledge.submitAnswer(attempt, input);
      return { accepted: true as const };
    },
  });
