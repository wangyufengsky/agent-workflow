import {
  acceptNodeOp,
  cancelTaskOp,
  confirmPlanOp,
  createTaskOp,
  deleteProjectOp,
  getNodeOp,
  getTaskOp,
  getTaskTimelineOp,
  listTasksOp,
  rejectNodeOp,
  replanOp,
  resolveInboxOp,
  retryNodeOp,
  retryTaskOp,
  startTaskOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { TasksService } from './tasks.service.ts';

export function tasksOperations(tasks: TasksService) {
  return [
    implement(listTasksOp, (filter) => ({ items: tasks.list(filter) })),
    implement(createTaskOp, (input) => tasks.create(input)),
    implement(getTaskOp, ({ id }) => tasks.detail(id)),
    implement(getTaskTimelineOp, ({ id, afterId }) => ({ items: tasks.timeline(id, afterId) })),
    implement(startTaskOp, ({ id }) => tasks.start(id)),
    implement(retryTaskOp, ({ id }) => tasks.retry(id)),
    implement(cancelTaskOp, ({ id, keepBranch }) => tasks.cancel(id, keepBranch ?? false)),
    implement(confirmPlanOp, ({ id, version }) => tasks.confirmPlan(id, version)),
    implement(replanOp, ({ id, feedback }) => tasks.replan(id, feedback)),
    implement(getNodeOp, ({ id, nodeId }) => tasks.node(id, nodeId)),
    implement(acceptNodeOp, ({ id, nodeId }) => tasks.acceptNode(id, nodeId)),
    implement(rejectNodeOp, ({ id, nodeId, feedback }) => tasks.rejectNode(id, nodeId, feedback)),
    implement(retryNodeOp, ({ id, nodeId, feedback }) => tasks.retryNode(id, nodeId, feedback)),
    implement(resolveInboxOp, ({ id, response }) => tasks.resolveInbox(id, response)),
    implement(deleteProjectOp, ({ id }) => tasks.deleteProject(id)),
  ];
}
