import { getWorkflowOp, listWorkflowsOp, updateWorkflowOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { WorkflowsService } from './workflows.service.ts';

export function workflowsOperations(workflows: WorkflowsService) {
  return [
    implement(listWorkflowsOp, () => ({ items: workflows.list() })),
    implement(getWorkflowOp, ({ id }) => workflows.get(id)),
    implement(updateWorkflowOp, (input) => workflows.update(input)),
  ];
}
