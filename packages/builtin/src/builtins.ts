import type { WorkflowDefinition } from '@aw/shared';
import { readRolePrompt, readWorkflowGuidance } from './prompts.ts';
import { BUILTIN_ROLES, type BuiltinRole } from './roles.ts';
import { BUILTIN_WORKFLOWS, type BuiltinWorkflow } from './workflows.ts';

export type RoleSeed = BuiltinRole & { prompt: string };
export type WorkflowSeed = Omit<BuiltinWorkflow, 'definition'> & { definition: WorkflowDefinition };

/** Built-in roles with their prompts, as synced into the database at startup (13). */
export function loadBuiltinRoles(promptsDir: string): RoleSeed[] {
  return BUILTIN_ROLES.map((role) => ({ ...role, prompt: readRolePrompt(promptsDir, role.key) }));
}

/** Built-in workflows; AI-planned ones get their planner guidance. */
export function loadBuiltinWorkflows(promptsDir: string): WorkflowSeed[] {
  return BUILTIN_WORKFLOWS.map((workflow) =>
    workflow.definition.plannerRole === undefined
      ? workflow
      : {
          ...workflow,
          definition: { ...workflow.definition, plannerGuidance: readWorkflowGuidance(promptsDir, workflow.key) },
        },
  );
}
