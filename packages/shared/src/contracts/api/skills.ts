import { z } from 'zod';
import { SKILL_SELECTION_MAX, USER_SKILL_MAX_CHARS } from '../../constants/limits.ts';
import { DEFINITION_KEY_PATTERN } from './workflows.ts';

export const skillRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
});
export type SkillRef = z.infer<typeof skillRefSchema>;

export const skillSnapshotSchema = skillRefSchema.extend({ body: z.string() });
export type SkillSnapshot = z.infer<typeof skillSnapshotSchema>;
export const skillSnapshotsSchema = z.array(skillSnapshotSchema);

export const userSkillSchema = skillRefSchema.extend({
  description: z.string(),
  source: z.string(),
});
export type UserSkillDTO = z.infer<typeof userSkillSchema>;

export const skillIdsSchema = z.array(z.uuid()).max(SKILL_SELECTION_MAX);
export const saveSkillSchema = z.object({ source: z.string().min(1).max(USER_SKILL_MAX_CHARS) });
export const projectSkillBindingSchema = z.object({
  projectId: z.string().min(1),
  workflowKey: z.string().regex(DEFINITION_KEY_PATTERN),
  skillIds: skillIdsSchema,
});
export type ProjectSkillBinding = z.infer<typeof projectSkillBindingSchema>;
