import { previewsOperations } from './previews.operations.ts';
import { createPreviewsService, type PreviewsServiceDeps } from './previews.service.ts';

export { createPreviewLog, launchPreview, setUpPreview } from './previews.process.ts';
export type { PreviewsService } from './previews.service.ts';

export function createPreviewsModule(deps: PreviewsServiceDeps) {
  const service = createPreviewsService(deps);
  return { service, operations: previewsOperations(service) };
}
