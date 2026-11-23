import { z } from 'zod';
import { SKILL_SELECTION_MAX, USER_SKILL_MAX_CHARS } from '../../constants/limits.ts';
import { SessionAgent } from '../../enums/workflow.ts';
import { DEFINITION_KEY_PATTERN } from './workflows.ts';

export const skillRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
});
export type SkillRef = z.infer<typeof skillRefSchema>;

const roleIdsSchema = z.array(z.uuid()).min(1).nullable();
// 旧任务正文快照没有 roleIds，继续适用于该任务的所有会话。
export const skillSnapshotSchema = skillRefSchema.extend({ body: z.string(), roleIds: roleIdsSchema.optional() });
export type SkillSnapshot = z.infer<typeof skillSnapshotSchema>;
export const skillSnapshotsSchema = z.array(skillSnapshotSchema);

export const userSkillSchema = skillRefSchema.extend({
  description: z.string(),
  source: z.string(),
  assistantEnabled: z.boolean(),
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

export const skillBindingScopeSchema = projectSkillBindingSchema
  .omit({ skillIds: true })
  .extend({ roleIds: roleIdsSchema });
export type SkillBindingScope = z.infer<typeof skillBindingScopeSchema>;

export const userSkillScopeSchema = z.object({
  id: z.uuid(),
  assistantEnabled: z.boolean(),
  bindings: z.array(skillBindingScopeSchema),
});
export type UserSkillScope = z.infer<typeof userSkillScopeSchema>;

export const builtinSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  assistantEnabled: z.boolean(),
  agents: z.array(z.enum(SessionAgent)),
  workflows: z.array(z.string()).optional(),
});
export type BuiltinSkillDTO = z.infer<typeof builtinSkillSchema>;

export const skillCatalogSchema = z.object({
  builtin: z.array(builtinSkillSchema),
  scopes: z.array(userSkillScopeSchema),
});
