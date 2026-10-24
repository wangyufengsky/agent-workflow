import {
  clearProjectHostingOp,
  createProjectOp,
  getProjectOp,
  initGitOp,
  listProjectsOp,
  previewGitInitOp,
  removeProjectAllowedBashOp,
  setProjectDbConnectionsOp,
  setProjectHostingOp,
  updateProjectOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { ProjectsService } from './projects.service.ts';

/** `projects.delete` removes the project's tasks too, so the tasks module implements it. */
export function projectsOperations(projects: ProjectsService) {
  return [
    implement(listProjectsOp, () => ({ items: projects.list() })),
    implement(createProjectOp, (input) => projects.create(input)),
    implement(previewGitInitOp, ({ repoPath }) => projects.previewGitInit(repoPath)),
    implement(initGitOp, (input) => projects.initGit(input)),
    implement(getProjectOp, ({ id }) => projects.get(id)),
    implement(updateProjectOp, (input) => projects.update(input)),
    implement(setProjectDbConnectionsOp, ({ id, connectionIds }) => projects.setDbConnections(id, connectionIds)),
    implement(removeProjectAllowedBashOp, ({ id, pattern }) => projects.removeAllowedBash(id, pattern)),
    implement(setProjectHostingOp, (input) => projects.setHosting(input)),
    implement(clearProjectHostingOp, ({ id }) => projects.clearHosting(id)),
  ];
}
