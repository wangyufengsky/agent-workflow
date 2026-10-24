import { z } from 'zod';
import {
  teamCommitSchema,
  teamCommitsQuerySchema,
  teamIdentitySchema,
  teamIdentityUpdateSchema,
  teamMemberDetailSchema,
  teamMemberQuerySchema,
  teamQuerySchema,
  teamSettingsSchema,
  teamSettingsUpdateSchema,
  teamSummarySchema,
} from '../contracts/api/team.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// The team page (33): read-only figures from the project's Git history, in both modes (D128).
const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;

const RANGE =
  'ref is a local or remote branch (the project default branch when left out); period is last_30_days, ' +
  'last_90_days, last_180_days, last_365_days or custom with from and to (YYYY-MM-DD)';

export const teamSummaryOp = defineOperationContract({
  ...common,
  id: 'team.summary',
  refs: { id: InputRef.Project },
  title: 'op.team.summary',
  description:
    "Each member's commits on a project's branch over a period: commits, active days, added and deleted lines " +
    '(lock files, build output and huge commits left out), files, median commit size, share of commits changing ' +
    'tests with the code, reverted commits, AI-marked commits and the kinds of work, with the previous period, ' +
    `team medians and the directories they work in. There are no scores or rankings. ${RANGE}`,
  input: teamQuerySchema,
  output: teamSummarySchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/team' },
});

export const teamMemberOp = defineOperationContract({
  ...common,
  id: 'team.member',
  refs: { id: InputRef.Project },
  title: 'op.team.member',
  description: `One member's figures, trend by bucket, identities and directories; member is the main email. ${RANGE}`,
  input: teamMemberQuerySchema,
  output: teamMemberDetailSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/team/members/:member' },
});

export const teamCommitsOp = defineOperationContract({
  ...common,
  id: 'team.commits',
  refs: { id: InputRef.Project },
  title: 'op.team.commits',
  description: `One member's commits in the period, newest first; pass nextCursor back as cursor. ${RANGE}`,
  input: teamCommitsQuerySchema,
  output: z.object({ items: z.array(teamCommitSchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/team/commits' },
});

export const updateTeamIdentityOp = defineOperationContract({
  ...common,
  id: 'team.identities.update',
  refs: { id: InputRef.Project },
  title: 'op.team.identities.update',
  description:
    'Change how an author email counts on the team page: merge it into another main email of the same person ' +
    '(memberEmail, null to undo), give it a display name, or set it as not a member (bots, CI accounts)',
  input: teamIdentityUpdateSchema,
  output: teamIdentitySchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/projects/:id/team/identities' },
});

export const getTeamSettingsOp = defineOperationContract({
  ...common,
  id: 'team.settings.get',
  refs: { id: InputRef.Project },
  title: 'op.team.settings.get',
  description: 'How the team page counts lines for a project: excluded files, test files, the huge commit size',
  input: z.object({ id: z.string() }),
  output: teamSettingsSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/team/settings' },
});

export const updateTeamSettingsOp = defineOperationContract({
  ...common,
  id: 'team.settings.update',
  refs: { id: InputRef.Project },
  title: 'op.team.settings.update',
  description: 'Change how the team page counts lines; null puts a field back to the default',
  input: teamSettingsUpdateSchema,
  output: teamSettingsSchema,
  risk: OperationRisk.Write,
  mode: UiMode.Pro,
  http: { method: 'PUT', path: '/projects/:id/team/settings' },
});
