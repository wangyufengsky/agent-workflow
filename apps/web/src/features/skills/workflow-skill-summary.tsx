import { useQuery } from '@tanstack/react-query';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import { projectSkillBindingsQuery, skillsQuery } from './skills.queries.ts';
import { UsedSkills } from './used-skills.tsx';

export function WorkflowSkillSummary({ projectId, workflowKey }: { projectId: string; workflowKey: string }) {
  const bindings = useQuery(projectSkillBindingsQuery(projectId));
  const binding = bindings.data?.find((item) => item.workflowKey === workflowKey);
  const library = useQuery({ ...skillsQuery, enabled: binding !== undefined && binding.skillIds.length > 0 });
  const skills = binding?.skillIds.flatMap((id) => library.data?.find((skill) => skill.id === id) ?? []) ?? [];
  return skills.length === 0 ? null : <UsedSkills label={C.willUse} skills={skills} />;
}
