import {
  getTeamSettingsOp,
  teamCommitsOp,
  teamMemberOp,
  teamSummaryOp,
  updateTeamIdentityOp,
  updateTeamSettingsOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { TeamService } from './team.service.ts';

export function teamOperations(team: TeamService) {
  return [
    implement(teamSummaryOp, (query) => team.summary(query)),
    implement(teamMemberOp, (query) => team.member(query)),
    implement(teamCommitsOp, (query) => team.commits(query)),
    implement(updateTeamIdentityOp, (update) => team.updateIdentity(update)),
    implement(getTeamSettingsOp, ({ id }) => team.settings(id)),
    implement(updateTeamSettingsOp, (update) => team.updateSettings(update)),
  ];
}
