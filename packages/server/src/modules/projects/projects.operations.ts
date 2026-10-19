import { createProjectOp, deleteProjectOp, getProjectOp, listProjectsOp, updateProjectOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { ProjectsService } from './projects.service.ts';

export function projectsOperations(projects: ProjectsService) {
  return [
    implement(listProjectsOp, () => ({ items: projects.list() })),
    implement(createProjectOp, (input) => projects.create(input)),
    implement(getProjectOp, ({ id }) => projects.get(id)),
    implement(updateProjectOp, (input) => projects.update(input)),
    implement(deleteProjectOp, ({ id }) => projects.delete(id)),
  ];
}
