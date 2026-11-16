import { type ProjectSkillBinding, setProjectSkillBindingOp, type UserSkillDTO } from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { SkillOptions } from './skill-options.tsx';
import { projectSkillBindingsQuery, skillCatalogQuery, skillsQuery } from './skills.queries.ts';

function BindingEditor({ binding, items }: { binding: ProjectSkillBinding; items: UserSkillDTO[] }) {
  const [selected, setSelected] = useState(binding.skillIds);
  const query = useQueryClient();
  const save = useMutation({
    mutationFn: () => callOperation(setProjectSkillBindingOp, { ...binding, skillIds: selected }),
    onSuccess: ({ skillIds }) => {
      void query.invalidateQueries({ queryKey: skillCatalogQuery.queryKey });
      query.setQueryData(projectSkillBindingsQuery(binding.projectId).queryKey, (previous) => [
        ...(previous ?? []).filter(({ workflowKey }) => workflowKey !== binding.workflowKey),
        { ...binding, skillIds },
      ]);
    },
  });
  const changed = selected.length !== binding.skillIds.length || selected.some((id, i) => id !== binding.skillIds[i]);
  return (
    <>
      <SkillOptions items={items} selected={selected} onChange={setSelected} />
      <div className="row">
        <Button disabled={!changed} pending={save.isPending} onClick={() => save.mutate()}>
          {C.saveBinding}
        </Button>
        {save.isSuccess && !changed && (
          <span className="hint" role="status">
            {C.saved}
          </span>
        )}
      </div>
      {save.isError && <ErrorState error={save.error} />}
    </>
  );
}

export function ProjectSkillBindings({ projectId }: { projectId: string }) {
  const [choice, setChoice] = useState<string>();
  const selectId = useId();
  const library = useQuery(skillsQuery);
  const workflows = useQuery(workflowsQuery);
  const bindings = useQuery(projectSkillBindingsQuery(projectId));
  const workflow = workflows.data?.find(({ key }) => key === choice) ?? workflows.data?.[0];
  const error = library.error ?? workflows.error ?? bindings.error;
  const bound =
    workflow === undefined ? undefined : bindings.data?.find(({ workflowKey }) => workflowKey === workflow.key);
  return (
    <Panel title={C.bindingTitle}>
      <p className="hint">{C.bindingHint}</p>
      {(library.isPending || workflows.isPending || bindings.isPending) && <span className="spin" />}
      {error !== null && <ErrorState error={error} />}
      {library.data?.length === 0 ? (
        <p className="hint">
          {C.empty}{' '}
          <Link to={ROUTES.skills} className="link">
            {C.title}
          </Link>
        </p>
      ) : workflows.data?.length === 0 ? (
        <p className="hint">{C.noWorkflows}</p>
      ) : library.data !== undefined && bindings.data !== undefined && workflow !== undefined ? (
        <>
          <div className="field">
            <label className="label" htmlFor={selectId}>
              {C.workflow}
            </label>
            <select id={selectId} className="input" value={workflow.key} onChange={(e) => setChoice(e.target.value)}>
              {workflows.data?.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <BindingEditor
            key={`${projectId}:${workflow.key}`}
            items={library.data}
            binding={bound ?? { projectId, workflowKey: workflow.key, skillIds: [] }}
          />
        </>
      ) : null}
    </Panel>
  );
}
