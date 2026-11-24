import type { ProjectDetailDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { PROJECTS_COPY as C } from '../../copy/projects.ts';
import { useRemoveAllowedBash } from './projects.queries.ts';

/** Pro section of a project (14 §3.7): the bash patterns its AI sessions run without asking, and revoking them (D101). */
export function ProjectAllowedBash({ project }: { project: ProjectDetailDTO }) {
  const remove = useRemoveAllowedBash();
  const rules = [
    ...project.allowedBash.map((pattern) => ({ key: pattern, label: pattern })),
    ...project.exactBash.map((g) => ({ key: `exact:${g.id}`, label: `${g.directory} · ${g.command}` })),
  ];
  return (
    <div className="col">
      <p className="hint">{C.allowedBashHint}</p>
      {rules.length === 0 ? (
        <p className="hint">{C.allowedBashNone}</p>
      ) : (
        <ul className="col" aria-label={C.allowedBash}>
          {rules.map(({ key: pattern, label }) => (
            <li key={pattern} className="row">
              <code className="grow mono">{label}</code>
              <Button
                size="sm"
                variant="ghost"
                pending={remove.isPending && remove.variables?.pattern === pattern}
                onClick={() => remove.mutate({ id: project.id, pattern }, { onSuccess: () => toast(C.revoked) })}
              >
                {C.revoke}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {remove.isError && <ErrorState error={remove.error} />}
    </div>
  );
}
