import {
  createWorkflowOp,
  getWorkflowOp,
  listWorkflowsOp,
  listWorkflowVersionsOp,
  updateWorkflowOp,
  validateWorkflowOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { WorkflowsService } from './workflows.service.ts';

/** Deleting a workflow needs to know its tasks: the tasks module implements it. */
export function workflowsOperations(workflows: WorkflowsService) {
  return [
    implement(listWorkflowsOp, () => ({ items: workflows.list() })),
    implement(getWorkflowOp, ({ id }) => workflows.get(id)),
    implement(listWorkflowVersionsOp, ({ key }) => ({ items: workflows.versions(key) })),
    implement(createWorkflowOp, (input) => workflows.create(input)),
    implement(validateWorkflowOp, (input) => workflows.validate(input)),
    implement(updateWorkflowOp, (input) => workflows.update(input)),
  ];
}
