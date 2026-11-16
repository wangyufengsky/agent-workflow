import {
  createSkillOp,
  deleteSkillOp,
  listProjectSkillBindingsOp,
  listSkillsOp,
  setProjectSkillBindingOp,
  updateSkillOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import { createSkillsService } from './skills.service.ts';

export { withUserSkills } from './skill-markdown.ts';
export type { SkillsService } from './skills.service.ts';

export function createSkillsModule(deps: Parameters<typeof createSkillsService>[0]) {
  const service = createSkillsService(deps);
  return {
    service,
    operations: [
      implement(listSkillsOp, () => ({ items: service.list() })),
      implement(createSkillOp, ({ source }) => service.create(source)),
      implement(updateSkillOp, ({ id, source }) => service.update(id, source)),
      implement(deleteSkillOp, ({ id }) => service.remove(id)),
      implement(listProjectSkillBindingsOp, ({ projectId }) => ({ items: service.bindings(projectId) })),
      implement(setProjectSkillBindingOp, (input) => service.bind(input)),
    ],
  };
}
