import { AttemptKind, McpToolName, submitSlideInputSchema, submitSlideOutputSchema } from '@aw/shared';
import type { DecksService } from '../../decks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export const submitSlideTool = (decks: DecksService) =>
  defineMcpTool({
    name: McpToolName.SubmitSlide,
    description:
      'Submit one page of the PPT: its page number, its content in one of the layouts and its speaker notes. Call it once per page your instructions list; the result lists the pages still to submit.',
    allowedKinds: [AttemptKind.DeckSlides],
    input: submitSlideInputSchema,
    output: submitSlideOutputSchema,
    handler: (input, { attempt }) => ({ accepted: true as const, ...decks.submitSlide(attempt, input) }),
  });
