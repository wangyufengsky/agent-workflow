import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { PathText } from '../../components/path-text.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { projectsQuery } from '../projects/projects.queries.ts';

/** Git console entry (14 §1, pro): one repository per project. */
export function GitConsolePage() {
  const projects = useQuery(projectsQuery);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      {projects.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
      <h2 className="sec-t">{C.pickProject}</h2>
      <div className="grid-3">
        {projects.data?.map((p) => (
          <Link key={p.id} to={ROUTES.gitProject} params={{ projectId: p.id }} className="card pad col">
            <span className="row">
              <Icon name="git" />
              <strong>{p.name}</strong>
            </span>
            <PathText path={p.repoPath} className="hint" />
          </Link>
        ))}
      </div>
    </div>
  );
}
