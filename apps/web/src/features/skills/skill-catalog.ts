import type { BuiltinSkillDTO, RoleDTO, UserSkillDTO, UserSkillScope } from '@aw/shared';
import { SessionAgent } from '@aw/shared';
import { BUILTIN_SKILL_COPY, SKILLS_COPY as C } from '../../copy/skills.ts';

export const SkillAudience = {
  Assistant: 'assistant',
  Researcher: 'researcher',
  Unconfigured: 'unconfigured',
} as const;
export type Audience = { id: string; name: string };

type Entry = {
  id: string;
  name: string;
  title: string;
  description: string;
  source: string;
  audiences: Audience[];
  allRoles: boolean;
};
export type CatalogEntry = Entry &
  ({ kind: 'builtin'; trigger: string } | { kind: 'mine'; skill: UserSkillDTO; scope: UserSkillScope });

const assistant: Audience = { id: SkillAudience.Assistant, name: C.assistant };
const researcher: Audience = { id: SkillAudience.Researcher, name: C.researcher };
export const audienceOptions = (roles: RoleDTO[]): Audience[] => [assistant, ...roles, researcher];

export function catalogEntries(
  userSkills: UserSkillDTO[],
  builtin: BuiltinSkillDTO[],
  scopes: UserSkillScope[],
  roles: RoleDTO[],
): CatalogEntry[] {
  const bySkill = new Map(scopes.map((scope) => [scope.id, scope]));
  const mine = userSkills.map((skill): CatalogEntry => {
    const scope = bySkill.get(skill.id) ?? { id: skill.id, assistantEnabled: skill.assistantEnabled, bindings: [] };
    const allRoles = scope.bindings.some((binding) => binding.roleIds === null);
    const bound = new Set(scope.bindings.flatMap(({ roleIds }) => roleIds ?? []));
    return {
      ...skill,
      kind: 'mine',
      skill,
      scope,
      title: skill.name,
      allRoles,
      audiences: [...(scope.assistantEnabled ? [assistant] : []), ...roles.filter(({ id }) => bound.has(id))],
    };
  });
  return [
    ...mine,
    ...builtin.map((skill): CatalogEntry => {
      const display = BUILTIN_SKILL_COPY[skill.name];
      return {
        ...skill,
        kind: 'builtin',
        id: skill.name,
        title: display?.title ?? skill.name,
        description: display?.description ?? skill.description,
        trigger: display?.trigger ?? skill.description,
        allRoles: false,
        audiences: [
          ...(skill.assistantEnabled ? [assistant] : []),
          ...roles.filter((role) => skill.agents.includes(role.baseAgent)),
          ...(skill.agents.includes(SessionAgent.Researcher) ? [researcher] : []),
        ],
      };
    }),
  ];
}

export function matchesAudience(entry: CatalogEntry, audience: string, roles: RoleDTO[]) {
  if (audience === '') return true;
  if (audience === SkillAudience.Unconfigured) return entry.audiences.length === 0 && !entry.allRoles;
  return (
    entry.audiences.some(({ id }) => id === audience) || (entry.allRoles && roles.some(({ id }) => id === audience))
  );
}
