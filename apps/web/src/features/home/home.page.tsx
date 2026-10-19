import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { HOME_COPY } from '../../copy/home.ts';
import { projectsQuery } from '../projects/projects.queries.ts';

/** M1 home: the start-task form arrives with the task pipeline (M3-11). */
export function HomePage() {
  const projects = useQuery(projectsQuery).data ?? [];
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="title grow">{HOME_COPY.title}</h1>
      </div>
      <div className="card">
        <EmptyState icon="sparkle" title={HOME_COPY.startLaterTitle} body={HOME_COPY.startLaterBody} />
      </div>
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{HOME_COPY.projects}</h2>
        </div>
        <div className="grid-3">
          {projects.map((p) => (
            <Link key={p.id} to={ROUTES.project} params={{ projectId: p.id }} className="card pad row">
              <span className="tile">
                <Icon name="folder" />
              </span>
              <span className="grow col">
                <span className="ellipsis">{p.name}</span>
                <span className="hint mono ellipsis">{p.defaultBranch}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
