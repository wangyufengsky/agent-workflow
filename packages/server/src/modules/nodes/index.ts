import { createNodesService, type NodesServiceDeps } from './nodes.service.ts';

export type { Node } from './nodes.repo.ts';
export { acceptanceProject } from './nodes.rules.ts';
export type { UnrunnableCheck } from './nodes.run.ts';
export type { MaterializeInput, NodeRunContext, NodesService } from './nodes.service.ts';
export { nodesTable } from './nodes.table.ts';

export function createNodesModule(deps: NodesServiceDeps) {
  return { service: createNodesService(deps) };
}
