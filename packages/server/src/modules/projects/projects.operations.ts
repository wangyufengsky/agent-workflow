import { createProjectOp, getProjectOp, listProjectsOp, updateProjectOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { ProjectsService } from './projects.service.ts';

/** `projects.delete` removes the project's tasks too, so the tasks module implements it. */
export function projectsOperations(projects: ProjectsService) {
  return [
    implement(listProjectsOp, () => ({ items: projects.list() })),
    implement(createProjectOp, (input) => projects.create(input)),
    implement(getProjectOp, ({ id }) => projects.get(id)),
    implement(updateProjectOp, (input) => projects.update(input)),
  ];
}
