import type { ProjectDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { PROJECTS_COPY } from '../../copy/projects.ts';
import { GitInitSummary } from './git-init-summary.tsx';
import { gitInitPreviewQuery, useInitGit } from './projects.queries.ts';

const C = PROJECTS_COPY.gitInit;

/** Offered when the chosen directory is in no Git repository (D153): what initialising does, then doing it. */
export function GitInitConfirm({
  repoPath,
  onAdded,
  onCancel,
}: {
  repoPath: string;
  onAdded: (project: ProjectDetailDTO) => void;
  onCancel: () => void;
}) {
  const preview = useQuery(gitInitPreviewQuery(repoPath));
  const init = useInitGit();
  const data = preview.data;

  return (
    <section className="banner info" aria-labelledby="git-init-title" data-testid="git-init">
      <Icon name="git" />
      <div className="grow col">
        <strong id="git-init-title">{C.title}</strong>
        <span>{C.body}</span>
        {preview.isPending && <span className="hint">{C.counting}</span>}
        {preview.isError && <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />}
        {data !== undefined && <GitInitSummary preview={data} />}
        {init.isError && <ErrorState error={init.error} />}
        <div className="row">
          <Button
            variant="primary"
            icon="git"
            disabled={data === undefined}
            pending={init.isPending}
            onClick={() => init.mutate({ repoPath }, { onSuccess: onAdded })}
          >
            {C.run}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {C.cancel}
          </Button>
        </div>
      </div>
    </section>
  );
}
