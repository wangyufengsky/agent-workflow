import {
  AttemptKind,
  McpToolName,
  submitDesignOutlineInputSchema,
  submitDesignOutlineOutputSchema,
  submitDesignReviewInputSchema,
  submitDesignReviewOutputSchema,
  submitDesignSectionInputSchema,
  submitDesignSectionOutputSchema,
} from '@aw/shared';
import type { DesignSubmissions } from '../../designs/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export function createDesignSubmissionTools(designs: DesignSubmissions) {
  return [
    defineMcpTool({
      name: McpToolName.SubmitDesignOutline,
      description: 'Submit the complete project design outline and the authorized paths assigned to each section.',
      allowedKinds: [AttemptKind.DesignOutline],
      input: submitDesignOutlineInputSchema,
      output: submitDesignOutlineOutputSchema,
      handler: (input, { attempt }) => designs.submitOutline(attempt, input),
    }),
    defineMcpTool({
      name: McpToolName.SubmitDesignSection,
      description:
        'Submit one complete target section, with evidence-backed behaviors, optional submodules, analyzed files and diagrams. Quote exact source lines in code blocks.',
      allowedKinds: [AttemptKind.DesignGenerate, AttemptKind.DesignRevise],
      input: submitDesignSectionInputSchema,
      output: submitDesignSectionOutputSchema,
      handler: (input, { attempt }) => designs.submitSection(attempt, input),
    }),
    defineMcpTool({
      name: McpToolName.SubmitDesignReview,
      description: 'Submit the independent review of the target sections, with findings tied to source evidence.',
      allowedKinds: [AttemptKind.DesignReview],
      input: submitDesignReviewInputSchema,
      output: submitDesignReviewOutputSchema,
      handler: (input, { attempt }) => designs.submitReview(attempt, input),
    }),
  ];
}
