import {
  AttemptKind,
  McpToolName,
  processDocumentDescription,
  processDocumentInputSchema,
  processDocumentOutputSchema,
} from '@aw/shared';
import type { AttemptsService } from '../../attempts/index.ts';
import type { DocumentProcessor } from '../../document-processor/index.ts';
import type { InitiativesService } from '../../initiatives/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export function processDocumentTool(
  processor: DocumentProcessor,
  tasks: TasksService,
  initiatives: InitiativesService,
  attempts: AttemptsService,
) {
  return defineMcpTool({
    name: McpToolName.ProcessDocument,
    description: processDocumentDescription,
    input: processDocumentInputSchema,
    output: processDocumentOutputSchema,
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review, AttemptKind.Breakdown],
    handler(input, { attempt, signal }) {
      return processor.process(
        input,
        (id) => {
          if (attempt.kind === AttemptKind.Breakdown) initiatives.assertAttachment(attempt, id);
          else tasks.assertAttachment(attempt, id);
        },
        signal,
        attempt.opencodeSessionId ? attempts.delegationSignal(attempt.id, attempt.opencodeSessionId) : undefined,
      );
    },
  });
}
