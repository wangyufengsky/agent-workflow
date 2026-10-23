import { createRequirementsService, type RequirementsServiceDeps } from './requirements.service.ts';

export type { Revision as RequirementRevision } from './requirements.repo.ts';
export type { NewRequirementResult, RequirementsService } from './requirements.service.ts';
export { requirementResultsTable, requirementRevisionsTable } from './requirements.table.ts';

export function createRequirementsModule(deps: RequirementsServiceDeps) {
  return { service: createRequirementsService(deps) };
}
