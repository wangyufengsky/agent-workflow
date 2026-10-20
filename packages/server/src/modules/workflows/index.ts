import { workflowsOperations } from './workflows.operations.ts';
import { createWorkflowsService, type WorkflowsServiceDeps } from './workflows.service.ts';

export type { WorkflowsService } from './workflows.service.ts';
export { workflowsTable } from './workflows.table.ts';

export function createWorkflowsModule(deps: WorkflowsServiceDeps) {
  const service = createWorkflowsService(deps);
  return { service, operations: workflowsOperations(service) };
}
