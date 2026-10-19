import { projectsOperations } from './projects.operations.ts';
import { createProjectsService, type ProjectsServiceDeps } from './projects.service.ts';

export type { ProjectsService } from './projects.service.ts';

export function createProjectsModule(deps: ProjectsServiceDeps) {
  const service = createProjectsService(deps);
  return { service, operations: projectsOperations(service) };
}
