import type { PlanDTO, RoleDTO, TaskDetailDTO } from '@aw/shared';
import type { CanvasStep } from '../../canvas/task-node.tsx';

/** Canvas steps of a task's nodes, with the progress line of the attempt working on each. */
export function stepsOfNodes(task: TaskDetailDTO): CanvasStep[] {
  return task.nodes.map((node) => ({
    id: node.id,
    key: node.key,
    title: node.title,
    role: node.roleName,
    dependsOn: node.dependsOn,
    status: node.status,
    attemptCount: node.attemptCount,
    activity: task.activeAttempts.find((a) => a.nodeId === node.id)?.progress ?? null,
  }));
}

/** Canvas steps of a plan that has no nodes yet (waiting for confirmation). */
export function stepsOfPlan(plan: PlanDTO, roles: readonly RoleDTO[]): CanvasStep[] {
  return plan.graph.nodes.map((node) => ({
    id: node.key,
    key: node.key,
    title: node.title,
    role: roles.find((r) => r.key === node.roleKey)?.name ?? node.roleKey,
    dependsOn: node.dependsOn,
  }));
}
