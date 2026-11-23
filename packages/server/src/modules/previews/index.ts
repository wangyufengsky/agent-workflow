import { previewsOperations } from './previews.operations.ts';
import { createPreviewsService, type PreviewsServiceDeps } from './previews.service.ts';

export { javaBuildExecutable, type PreviewCommand, projectLaunchEnvironment } from './previews.commands.ts';
export { hasJavaMain } from './previews.java-source.ts';
export { createPreviewLog, type LaunchInput, launchPreview, setUpPreview } from './previews.process.ts';
export { createProjectLog } from './previews.project-log.ts';
export type { PreviewsService } from './previews.service.ts';
export { startServiceGroup } from './previews.service-group.ts';
export { committedSources, resolveTestLaunch, worktreeSources } from './previews.test-launch.ts';

export function createPreviewsModule(deps: PreviewsServiceDeps) {
  const service = createPreviewsService(deps);
  return { service, operations: previewsOperations(service) };
}
