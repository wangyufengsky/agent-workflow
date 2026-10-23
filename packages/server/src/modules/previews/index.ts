import { previewsOperations } from './previews.operations.ts';
import { createPreviewsService, type PreviewsServiceDeps } from './previews.service.ts';

export type { PreviewsService } from './previews.service.ts';

export function createPreviewsModule(deps: PreviewsServiceDeps) {
  const service = createPreviewsService(deps);
  return { service, operations: previewsOperations(service) };
}
