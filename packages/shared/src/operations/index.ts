import { abortAttemptOp, getAttemptOp } from './attempts.ts';
import { startDebugAttemptOp } from './debug.ts';
import type { OperationContract } from './define.ts';
import { createProjectOp, deleteProjectOp, getProjectOp, listProjectsOp, updateProjectOp } from './projects.ts';
import { getSettingsOp, updateSettingsOp } from './settings.ts';
import { getEnvironmentOp, getHealthOp, getRuntimeOp, recheckEnvironmentOp, restartRuntimeOp } from './system.ts';
import { getWorkflowOp, listRolesOp, listWorkflowsOp, updateRoleOp, updateWorkflowOp } from './workflows.ts';

export * from './attempts.ts';
export * from './debug.ts';
export * from './define.ts';
export * from './projects.ts';
export * from './settings.ts';
export * from './system.ts';
export * from './workflows.ts';

/** Every operation contract; the server mounts exactly these and the copy table covers all their titles. */
export const OPERATION_CONTRACTS: readonly OperationContract[] = [
  getSettingsOp,
  updateSettingsOp,
  getHealthOp,
  getEnvironmentOp,
  recheckEnvironmentOp,
  getRuntimeOp,
  restartRuntimeOp,
  listProjectsOp,
  createProjectOp,
  getProjectOp,
  updateProjectOp,
  deleteProjectOp,
  getAttemptOp,
  abortAttemptOp,
  startDebugAttemptOp,
  listWorkflowsOp,
  getWorkflowOp,
  updateWorkflowOp,
  listRolesOp,
  updateRoleOp,
];
