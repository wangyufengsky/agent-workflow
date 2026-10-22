import { type WorkflowDefinition, WorkflowKind } from '@aw/shared';
import { readRolePrompt, readWorkflowGuidance } from './prompts.ts';
import { BUILTIN_ROLES, type BuiltinRole } from './roles.ts';
import { SYSTEM_WORKFLOWS } from './system-workflows.ts';
import { BUILTIN_WORKFLOWS, type BuiltinWorkflow } from './workflows.ts';

export type RoleSeed = BuiltinRole & { prompt: string };
export type WorkflowSeed = Omit<BuiltinWorkflow, 'definition'> & {
  definition: WorkflowDefinition;
  /** Built-in workflows are listed; system workflows only the app starts (27 §3.6). */
  kind: typeof WorkflowKind.Builtin | typeof WorkflowKind.System;
};

/** Built-in roles with their prompts, as synced into the database at startup (13). */
export function loadBuiltinRoles(promptsDir: string): RoleSeed[] {
  return BUILTIN_ROLES.map((role) => ({ ...role, prompt: readRolePrompt(promptsDir, role.key) }));
}

/** Built-in and system workflows; AI-planned ones get their planner guidance. */
export function loadBuiltinWorkflows(promptsDir: string): WorkflowSeed[] {
  const withGuidance = (workflow: BuiltinWorkflow) =>
    workflow.definition.plannerRole === undefined
      ? workflow
      : {
          ...workflow,
          definition: { ...workflow.definition, plannerGuidance: readWorkflowGuidance(promptsDir, workflow.key) },
        };
  return [
    ...BUILTIN_WORKFLOWS.map((w) => ({ ...withGuidance(w), kind: WorkflowKind.Builtin })),
    ...SYSTEM_WORKFLOWS.map((w) => ({ ...w, kind: WorkflowKind.System })),
  ];
}
