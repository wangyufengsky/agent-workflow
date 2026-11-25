import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { ROUTE_IDS } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { DesignOutline } from './design-outline.tsx';
import { DesignWorkbench } from './design-workbench.tsx';
import { designQuery } from './designs.queries.ts';

const route = getRouteApi(ROUTE_IDS.designWorkbench);

export function DesignWorkbenchPage() {
  const { designId } = route.useParams();
  const { model: savedModel } = route.useSearch();
  const settings = useSettings();
  const query = useQuery(designQuery(designId));
  const projectId = query.data?.projectId ?? null;
  const project = useQuery({ ...projectQuery(projectId ?? ''), enabled: projectId !== null });
  if (query.isError)
    return (
      <div className="page">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  if (query.isPending)
    return (
      <div className="page">
        <p className="hint">{COMMON_COPY.loading}</p>
      </div>
    );
  const design = query.data;
  const model = savedModel === undefined ? settings['ai.defaultModel'] : savedModel || null;
  return design.outlineConfirmedAt === null ? (
    <DesignOutline key={designId} design={design} model={model} />
  ) : (
    <DesignWorkbench key={designId} design={design} model={model} repoPath={project.data?.repoPath ?? null} />
  );
}
