import {
  AppError,
  AttemptKind,
  analyzeImageDescription,
  analyzeImageInputSchema,
  analyzeImageOutputSchema,
  ErrorCode,
  McpToolName,
} from '@aw/shared';
import type { AttachmentsService } from '../../attachments/index.ts';
import type { AttemptsService } from '../../attempts/index.ts';
import type { BrowserService } from '../../browser/index.ts';
import type { ImageAnalysis } from '../../image-analysis/index.ts';
import type { InitiativesService } from '../../initiatives/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export function imageAnalysisTool({
  attempts,
  attachments,
  browser,
  imageAnalysis,
  initiatives,
  tasks,
}: {
  attempts: AttemptsService;
  attachments: AttachmentsService;
  browser: BrowserService;
  imageAnalysis: ImageAnalysis;
  initiatives: InitiativesService;
  tasks: TasksService;
}) {
  return defineMcpTool({
    name: McpToolName.AnalyzeImage,
    description: analyzeImageDescription,
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review, AttemptKind.Breakdown],
    input: analyzeImageInputSchema,
    output: analyzeImageOutputSchema,
    handler({ source, question }, { attempt, signal }) {
      const parent = attempt.opencodeSessionId
        ? attempts.delegationSignal(attempt.id, attempt.opencodeSessionId)
        : undefined;
      if ('attachment_id' in source) {
        if (attempt.kind === AttemptKind.Breakdown) initiatives.assertAttachment(attempt, source.attachment_id);
        else tasks.assertAttachment(attempt, source.attachment_id);
        const { name, mime, path } = attachments.image(source.attachment_id);
        return imageAnalysis.analyze({ path, mime, reference: { ...source, name } }, question, signal, parent);
      }
      const origin = source.attempt_id === undefined ? attempt : attempts.get(source.attempt_id);
      if (attempt.taskId === null || origin.taskId !== attempt.taskId) {
        throw new AppError(ErrorCode.NotFound, 'The screenshot must belong to this task');
      }
      const path = browser.attemptFile(origin.id, source.screenshot);
      return imageAnalysis.analyze(
        {
          path,
          mime: 'image/jpeg',
          reference: { screenshot: source.screenshot, attempt_id: origin.id },
        },
        question,
        signal,
        parent,
      );
    },
  });
}
