import {
  type ProjectDTO,
  TEAM_GRANULARITIES,
  TEAM_MAX_BUCKETS,
  TEAM_PERIODS,
  TeamGranularity,
  TeamPeriod,
  type TeamQuery,
} from '@aw/shared';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { formatTime } from '../../copy/common.ts';
import { TEAM_COPY as C, TEAM_GRANULARITY_LABEL, TEAM_PERIOD_LABEL } from '../../copy/team.ts';
import { gitBranchesQuery, useFetch } from '../git/git.queries.ts';
import { GitMenu } from '../git/git-menu.tsx';
import { projectsQuery } from '../projects/projects.queries.ts';
import styles from './team.module.css';
import { daysOf, granularityOf, localDate, type TeamSearch } from './team-search.ts';

type Scope = { ref: string; tip: { sha: string; committedAt: number } | null; fetchedAt: number | null };

/** The figures' project, branch, period and buckets, and how fresh the branch is (33 §5.2 ①). */
export function TeamToolbar({
  project,
  query,
  scope,
  onSearch,
  onProject,
}: {
  project: ProjectDTO;
  query: TeamQuery;
  scope: Scope | undefined;
  onSearch: (change: Partial<TeamSearch>) => void;
  onProject: (projectId: string) => void;
}) {
  const projects = useQuery(projectsQuery).data ?? [];
  const branches = (useQuery(gitBranchesQuery(project.id)).data ?? []).filter((b) => b.task === null);
  const fetch = useFetch(project.id);
  const queryClient = useQueryClient();
  const ref = query.ref ?? project.defaultBranch;
  const days = daysOf(query);
  const granularity = granularityOf(query);
  const today = localDate(Date.now());

  return (
    <div className="col">
      <div className={styles.toolbar} data-testid="team-toolbar">
        <GitMenu
          label={C.switchProject}
          className={styles.chip}
          trigger={
            <>
              {project.name}
              <Icon name="chevDown" size="sm" />
            </>
          }
          items={projects.map((p) => ({ label: p.name, onSelect: () => onProject(p.id) }))}
        />
        <label className={styles.inline}>
          <Icon name="branch" size="sm" />
          <span className="sr">{C.branch}</span>
          <select
            className="select mono"
            aria-label={C.branch}
            value={ref}
            onChange={(e) => onSearch({ ref: e.target.value === project.defaultBranch ? undefined : e.target.value })}
          >
            {!branches.some((b) => b.name === ref) && <option value={ref}>{ref}</option>}
            <optgroup label={C.localBranches}>
              {branches
                .filter((b) => !b.remote)
                .map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label={C.remoteBranches}>
              {branches
                .filter((b) => b.remote)
                .map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <fieldset className="seg" aria-label={C.periodLabel}>
          {TEAM_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === query.period}
              onClick={() =>
                onSearch(
                  p === TeamPeriod.Custom
                    ? { period: p, from: query.from, to: query.to }
                    : { period: p, from: undefined, to: undefined },
                )
              }
            >
              {TEAM_PERIOD_LABEL[p]}
            </button>
          ))}
        </fieldset>
        {query.period === TeamPeriod.Custom && (
          <>
            <input
              type="date"
              className="input"
              aria-label={C.from}
              value={query.from}
              max={query.to}
              onChange={(e) => onSearch({ from: e.target.value, to: query.to })}
            />
            <input
              type="date"
              className="input"
              aria-label={C.to}
              value={query.to}
              min={query.from}
              max={today}
              onChange={(e) => onSearch({ from: query.from, to: e.target.value })}
            />
          </>
        )}
        <fieldset className="seg" aria-label={C.granularityLabel}>
          {TEAM_GRANULARITIES.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={g === granularity}
              disabled={g === TeamGranularity.Day && days > TEAM_MAX_BUCKETS}
              onClick={() => onSearch({ granularity: g })}
            >
              {TEAM_GRANULARITY_LABEL[g]}
            </button>
          ))}
        </fieldset>
      </div>
      <div className={styles.freshness}>
        {scope?.tip != null && <span>{C.dataAsOf(scope.ref, formatTime(scope.tip.committedAt))}</span>}
        <span>{scope?.fetchedAt == null ? C.neverFetched : C.fetchedAt(formatTime(scope.fetchedAt))}</span>
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          pending={fetch.isPending}
          onClick={() =>
            fetch.mutate(undefined, {
              onSuccess: () => {
                toast(C.fetched);
                void queryClient.invalidateQueries({ queryKey: queryKeys.team(project.id) });
              },
            })
          }
        >
          {C.fetch}
        </Button>
      </div>
    </div>
  );
}

/** While the commits are read for the first time (33 §7.2). */
export function ScanProgress({ projectId }: { projectId: string }) {
  const scan = useQuery<{ done: number; total: number }>({
    queryKey: queryKeys.teamScan(projectId),
    queryFn: skipToken,
  }).data;
  return (
    <p className="hint" data-testid="team-scan">
      {scan === undefined || scan.done === scan.total ? C.scanningStart : C.scanning(scan.done, scan.total)}
    </p>
  );
}
