import type { ProjectDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DATABASES_COPY as C } from '../../copy/databases.ts';
import { NAV_COPY } from '../../copy/nav.ts';
import { dbConnectionsQuery, useSetProjectDbConnections } from './databases.queries.ts';

/** Pro section of a project (14 §3.7): the databases its AI sessions may query (M5-07). */
export function ProjectDatabases({ project }: { project: ProjectDetailDTO }) {
  const connections = useQuery(dbConnectionsQuery);
  const save = useSetProjectDbConnections();
  const [selected, setSelected] = useState<readonly string[]>(project.dbConnectionIds);
  if (connections.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (connections.isError) return <ErrorState error={connections.error} onRetry={() => void connections.refetch()} />;
  if (connections.data.length === 0) {
    return (
      <p className="hint">
        {C.projectNone} <Link to={ROUTES.databases}>{NAV_COPY.databases}</Link>
      </p>
    );
  }
  return (
    <div className="col">
      <p className="hint">{C.projectHint}</p>
      <fieldset className="col" aria-label={C.projectSection}>
        {connections.data.map((c) => (
          <label key={c.id} className="check">
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))
              }
            />
            <span>
              {c.name} <span className="hint mono">{c.database}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {save.isError && <ErrorState error={save.error} />}
      <div className="row">
        <Button
          variant="primary"
          pending={save.isPending}
          onClick={() =>
            save.mutate({ id: project.id, connectionIds: [...selected] }, { onSuccess: () => toast(C.projectSaved) })
          }
        >
          {COMMON_COPY.save}
        </Button>
      </div>
    </div>
  );
}
