import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { PROJECTS_COPY as C } from '../../copy/projects.ts';
import { AddProjectForm } from './add-project-form.tsx';
import { projectsQuery } from './projects.queries.ts';

const route = getRouteApi(ROUTE_IDS.projects);

export function ProjectsPage() {
  const projects = useQuery(projectsQuery);
  const adding = route.useSearch().add === true;
  const navigate = route.useNavigate();
  const setAdding = (open: boolean) => void navigate({ search: open ? { add: true } : {} });

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
          {C.add}
        </Button>
      </div>
      {projects.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
      {projects.data?.length === 0 && <EmptyState icon="folder" title={C.emptyTitle} body={C.emptyBody} />}
      <div className="grid-2">
        {projects.data?.map((p) => (
          <Link key={p.id} to={ROUTES.project} params={{ projectId: p.id }} className="card pad col">
            <span className="row">
              <span className="tile">
                <Icon name="folder" />
              </span>
              <span className="section-title grow ellipsis">{p.name}</span>
              <span className="chip mono">
                <Icon name="branch" size="sm" />
                {p.defaultBranch}
              </span>
            </span>
            <span className="hint mono ellipsis">{p.repoPath}</span>
            <span className="hint">
              {C.checkCommand}：<span className="mono">{p.checkCommand ?? C.noCheckCommand}</span>
            </span>
          </Link>
        ))}
      </div>
      <Dialog open={adding} onOpenChange={setAdding} title={C.addTitle}>
        <AddProjectForm
          onAdded={(project) => {
            toast(C.added);
            void navigate({ to: ROUTES.project, params: { projectId: project.id }, search: {} });
          }}
        />
      </Dialog>
    </div>
  );
}
