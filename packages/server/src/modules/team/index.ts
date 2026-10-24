import { teamOperations } from './team.operations.ts';
import { createTeamService, type TeamServiceDeps } from './team.service.ts';

export type { TeamService } from './team.service.ts';

/** The team page (33): each member's work from the project's Git history. */
export function createTeamModule(deps: TeamServiceDeps) {
  const service = createTeamService(deps);
  return { service, operations: teamOperations(service) };
}
