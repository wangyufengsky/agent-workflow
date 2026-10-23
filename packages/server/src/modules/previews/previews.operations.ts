import { getPreviewOp, startPreviewOp, stopPreviewOp, trialPreviewOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { PreviewsService } from './previews.service.ts';

export function previewsOperations(previews: PreviewsService) {
  return [
    implement(getPreviewOp, ({ taskId }) => previews.get(taskId)),
    implement(startPreviewOp, ({ taskId }) => previews.start(taskId)),
    implement(stopPreviewOp, ({ taskId }) => previews.stop(taskId)),
    implement(trialPreviewOp, ({ projectId }) => previews.trial(projectId)),
  ];
}
