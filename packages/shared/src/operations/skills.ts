import { z } from 'zod';
import { projectSkillBindingSchema, saveSkillSchema, userSkillSchema } from '../contracts/api/skills.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const common = { mode: UiMode.Simple, expose: { palette: false, assistant: false }, credentialFields: [] } as const;
const skillId = z.object({ id: z.uuid() });

export const listSkillsOp = defineOperationContract({
  ...common,
  id: 'skills.list',
  title: 'op.skills.list',
  description: 'List the user’s saved skills',
  input: z.object({}),
  output: z.object({ items: z.array(userSkillSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/skills' },
});

export const createSkillOp = defineOperationContract({
  ...common,
  id: 'skills.create',
  title: 'op.skills.create',
  description: 'Save an editable SKILL.md draft to My Skills',
  input: saveSkillSchema,
  output: userSkillSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/skills', status: 201 },
});

export const updateSkillOp = defineOperationContract({
  ...common,
  id: 'skills.update',
  title: 'op.skills.update',
  description: 'Save a new version of a user skill',
  input: saveSkillSchema.extend(skillId.shape),
  output: userSkillSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/skills/:id' },
});

export const deleteSkillOp = defineOperationContract({
  ...common,
  id: 'skills.delete',
  title: 'op.skills.delete',
  description: 'Delete a user skill and release its project workflow bindings',
  input: skillId,
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/skills/:id' },
});

export const listProjectSkillBindingsOp = defineOperationContract({
  ...common,
  id: 'skills.listProjectBindings',
  title: 'op.skills.listProjectBindings',
  description: 'List the skills applied to each workflow in a project',
  input: projectSkillBindingSchema.pick({ projectId: true }),
  output: z.object({ items: z.array(projectSkillBindingSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:projectId/skill-bindings' },
});

export const setProjectSkillBindingOp = defineOperationContract({
  ...common,
  id: 'skills.setProjectBinding',
  title: 'op.skills.setProjectBinding',
  description: 'Choose the user skills for new tasks of one project workflow',
  input: projectSkillBindingSchema,
  output: projectSkillBindingSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/projects/:projectId/skill-bindings/:workflowKey' },
});
