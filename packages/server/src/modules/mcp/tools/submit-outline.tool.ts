import { AttemptKind, McpToolName, submitOutlineInputSchema, submitOutlineOutputSchema } from '@aw/shared';
import type { DecksService } from '../../decks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitOutlineTool = (decks: DecksService) =>
  defineMcpTool({
    name: McpToolName.SubmitOutline,
    description:
      "Submit the PPT's outline: its title, your understanding of the audience and length with your assumptions, and the pages in order. Call it once; the outline is not written until it succeeds.",
    allowedKinds: [AttemptKind.DeckOutline],
    input: submitOutlineInputSchema,
    output: submitOutlineOutputSchema,
    handler: (input, { attempt }) => {
      decks.submitOutline(attempt, input);
      return { accepted: true as const };
    },
  });
