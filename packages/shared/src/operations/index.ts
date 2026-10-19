import type { OperationContract } from './define.ts';
import { createProjectOp, deleteProjectOp, getProjectOp, listProjectsOp, updateProjectOp } from './projects.ts';
import { getSettingsOp, updateSettingsOp } from './settings.ts';
import { getEnvironmentOp, getHealthOp, recheckEnvironmentOp } from './system.ts';

export * from './define.ts';
export * from './projects.ts';
export * from './settings.ts';
export * from './system.ts';

/** Every operation contract; the server mounts exactly these and the copy table covers all their titles. */
export const OPERATION_CONTRACTS: readonly OperationContract[] = [
  getSettingsOp,
  updateSettingsOp,
  getHealthOp,
  getEnvironmentOp,
  recheckEnvironmentOp,
  listProjectsOp,
  createProjectOp,
  getProjectOp,
  updateProjectOp,
  deleteProjectOp,
];
