import { abortAttemptOp, getAttemptOp } from './attempts.ts';
import { startDebugAttemptOp } from './debug.ts';
import type { OperationContract } from './define.ts';
import {
  gitBranchesOp,
  gitCommitOp,
  gitDiffFileOp,
  gitDiffOp,
  gitFetchOp,
  gitFileOp,
  gitLogOp,
  gitStatusOp,
  gitTreeOp,
  listWorktreesOp,
  pruneWorktreesOp,
} from './git.ts';
import { countInboxOp, dismissInboxOp, listInboxOp, resolveInboxOp } from './inbox.ts';
import {
  clearProjectHostingOp,
  createProjectOp,
  deleteProjectOp,
  getProjectOp,
  listProjectsOp,
  setProjectHostingOp,
  updateProjectOp,
} from './projects.ts';
import { getSettingsOp, updateSettingsOp } from './settings.ts';
import { getEnvironmentOp, getHealthOp, getRuntimeOp, recheckEnvironmentOp, restartRuntimeOp } from './system.ts';
import {
  acceptNodeOp,
  cancelTaskOp,
  confirmPlanOp,
  createTaskOp,
  deliverTaskOp,
  getNodeOp,
  getPlanOp,
  getTaskOp,
  getTaskTimelineOp,
  listPlansOp,
  listTasksOp,
  nodeDiffFileOp,
  nodeDiffOp,
  pauseTaskOp,
  rejectNodeOp,
  replanOp,
  requestChangesOp,
  resumeTaskOp,
  retryNodeOp,
  retryTaskOp,
  saveDraftPlanOp,
  skipNodeOp,
  startTaskOp,
  taskDiffFileOp,
  taskDiffOp,
} from './tasks.ts';
import { getWorkflowOp, listRolesOp, listWorkflowsOp, updateRoleOp, updateWorkflowOp } from './workflows.ts';

export * from './attempts.ts';
export * from './debug.ts';
export * from './define.ts';
export * from './git.ts';
export * from './inbox.ts';
export * from './projects.ts';
export * from './settings.ts';
export * from './system.ts';
export * from './tasks.ts';
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
  setProjectHostingOp,
  clearProjectHostingOp,
  getAttemptOp,
  abortAttemptOp,
  startDebugAttemptOp,
  listWorkflowsOp,
  getWorkflowOp,
  updateWorkflowOp,
  listRolesOp,
  updateRoleOp,
  listTasksOp,
  createTaskOp,
  getTaskOp,
  getTaskTimelineOp,
  startTaskOp,
  retryTaskOp,
  cancelTaskOp,
  pauseTaskOp,
  resumeTaskOp,
  listPlansOp,
  getPlanOp,
  saveDraftPlanOp,
  confirmPlanOp,
  replanOp,
  getNodeOp,
  acceptNodeOp,
  rejectNodeOp,
  retryNodeOp,
  skipNodeOp,
  taskDiffOp,
  taskDiffFileOp,
  nodeDiffOp,
  nodeDiffFileOp,
  deliverTaskOp,
  requestChangesOp,
  listInboxOp,
  countInboxOp,
  resolveInboxOp,
  dismissInboxOp,
  gitStatusOp,
  gitBranchesOp,
  gitLogOp,
  gitCommitOp,
  gitDiffOp,
  gitDiffFileOp,
  gitTreeOp,
  gitFileOp,
  gitFetchOp,
  listWorktreesOp,
  pruneWorktreesOp,
];
