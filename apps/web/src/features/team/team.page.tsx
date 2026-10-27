import { TeamOtherKind, type TeamSummaryDTO, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Navigate, useNavigate } from '@tanstack/react-router';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { BarChart } from '../../components/charts/bar-chart.tsx';
import { toneOf } from '../../components/charts/series.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TEAM_COPY as C, formatBucket, formatCount, formatRate } from '../../copy/team.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { projectQuery, projectsQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { ANALYSIS_HASH, AnalyseAllButton, TeamAnalyses } from './member-analysis.tsx';
import styles from './team.module.css';
import { teamSummaryQuery } from './team.queries.ts';
import {
  CompareBars,
  Delta,
  DirectoryShares,
  Lines,
  METRICS,
  MemberTable,
  MetricCard,
  type MetricKey,
} from './team-parts.tsx';
import { type TeamSearch, teamQueryOf } from './team-search.ts';
import { TeamSettingsDrawer } from './team-settings.tsx';
import { ScanProgress, TeamToolbar } from './team-toolbar.tsx';

const route = getRouteApi(ROUTE_IDS.team);
const TREND_MEMBERS = 8;

/** `/team`: the project looked at last in this run of the app, else the first one (33 §5.1). */
export function TeamIndexPage() {
  const projects = useQuery(projectsQuery);
  const last = useUiStore((s) => s.teamProjectId);
  if (projects.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (projects.isError) {
    return (
      <div className="page">
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      </div>
    );
  }
  const target = projects.data.find((p) => p.id === last) ?? projects.data[0];
  if (target === undefined) {
    return (
      <div className="page">
        <EmptyState icon="team" title={C.noProjects} body={C.noProjectsBody} />
      </div>
    );
  }
  return <Navigate to={ROUTES.team} params={{ projectId: target.id }} search={{}} replace />;
}

/** `/team/:projectId` (33 §5.2): the members' figures side by side; nothing is scored or ranked (D128). */
export function TeamPage() {
  const { projectId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const setTeamProject = useUiStore((s) => s.setTeamProject);
  const project = useQuery(projectQuery(projectId));
  const query = teamQueryOf(projectId, search);
  const summary = useQuery(teamSummaryQuery(query));
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const analyses = useRef<HTMLElement>(null);
  useEffect(() => setTeamProject(projectId), [setTeamProject, projectId]);

  const onSearch = (change: Partial<TeamSearch>) =>
    void navigate({ to: ROUTES.team, params: { projectId }, search: { ...search, ...change } });
  const onProject = (id: string) =>
    void navigate({ to: ROUTES.team, params: { projectId: id }, search: { ...search, ref: undefined } });

  if (project.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (project.isError) {
    return (
      <div className="page">
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        {summary.data !== undefined && (
          <AnalyseAllButton
            query={query}
            members={summary.data.members.filter((m) => m.metrics.commits > 0).map((m) => m.key)}
            onStarted={() => analyses.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        )}
        {pro && (
          <Button variant="secondary" icon="settings" onClick={() => setSettingsOpen(true)}>
            {C.settingsTitle}
          </Button>
        )}
      </div>
      <TeamToolbar
        project={project.data}
        query={query}
        scope={summary.data}
        onSearch={onSearch}
        onProject={onProject}
      />
      {summary.isPending && <ScanProgress projectId={projectId} />}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />}
      {summary.data !== undefined && (
        <Overview
          summary={summary.data}
          analysesRef={analyses}
          onOpen={(member) => void navigate({ to: ROUTES.teamMember, params: { projectId, member }, search })}
          onReport={(member) =>
            void navigate({ to: ROUTES.teamMember, params: { projectId, member }, search, hash: ANALYSIS_HASH })
          }
        />
      )}
      {pro && <TeamSettingsDrawer projectId={projectId} open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </div>
  );
}

function Overview({
  summary,
  analysesRef,
  onOpen,
  onReport,
}: {
  summary: TeamSummaryDTO;
  analysesRef: RefObject<HTMLElement | null>;
  onOpen: (memberKey: string) => void;
  /** To the member page's AI analysis. */
  onReport: (memberKey: string) => void;
}) {
  const [metric, setMetric] = useState<MetricKey>('commits');
  const { totals, previousTotals } = summary;
  if (summary.members.length === 0 && summary.others.length === 0) {
    return <EmptyState icon="team" title={C.empty} body={C.emptyBody} />;
  }
  const trendMembers = summary.members.slice(0, TREND_MEMBERS);
  const rest = summary.members.slice(TREND_MEMBERS);
  // One stacked lane per member, the members after the first few summed as「其他」.
  const lanes = [
    ...trendMembers.map((m, i) => ({
      series: { name: m.name, tone: toneOf(i) },
      value: (b: number) => m.series[b]?.commits ?? 0,
    })),
    ...(rest.length === 0
      ? []
      : [
          {
            series: { name: C.others, tone: 'sRest' as const },
            value: (b: number) => rest.reduce((n, m) => n + (m.series[b]?.commits ?? 0), 0),
          },
        ]),
  ];
  const days = summary.buckets.map((bucket, b) => ({
    date: bucket.from,
    values: lanes.map((lane) => ({ series: lane.series, value: lane.value(b) })),
  }));
  return (
    <>
      <section className="section" aria-label={C.totalsTitle}>
        <div className="grid-4" data-testid="team-totals">
          <MetricCard
            label={C.metric.commits}
            hint={C.metricHint.commits}
            value={formatCount(totals.commits)}
            delta={<Delta current={totals.commits} previous={previousTotals.commits} />}
            sub={C.activeMembers(summary.members.filter((m) => m.metrics.commits > 0).length)}
          />
          <MetricCard
            label={C.metric.lines}
            hint={C.metricHint.lines}
            value={formatCount(totals.added + totals.deleted)}
            delta={
              <Delta current={totals.added + totals.deleted} previous={previousTotals.added + previousTotals.deleted} />
            }
            sub={<Lines added={totals.added} deleted={totals.deleted} />}
          />
          <MetricCard
            label={C.metric.testRate}
            hint={C.metricHint.testRate}
            value={formatRate(totals.testRate)}
            delta={<Delta current={totals.testRate} previous={previousTotals.testRate} />}
          />
          <MetricCard
            label={C.metric.aiCommits}
            hint={C.metricHint.aiCommits}
            value={formatCount(totals.aiCommits)}
            sub={`${C.metric.taskCommits} ${formatCount(totals.taskCommits)}`}
          />
        </div>
        <p className={`hint ${styles.note}`}>
          {C.linesNote}
          {totals.hugeCommits > 0 && ` ${C.hugeNote(totals.hugeCommits)}。`}
        </p>
      </section>

      <section className="section card pad" aria-label={C.trendTitle}>
        <h2 className="section-title">{C.trendTitle}</h2>
        <BarChart
          label={C.trendTitle}
          series={lanes.map((lane) => lane.series)}
          days={days}
          format={formatCount}
          formatAxis={formatCount}
          formatDate={(date) => formatBucket(date, summary.granularity)}
          tableCaption={C.trendTable}
        />
      </section>

      <section className="section card" aria-label={C.membersTitle}>
        <div className="card-head">
          <h2 className="section-title grow">{C.membersTitle}</h2>
          <span className="hint">{C.membersLede}</span>
        </div>
        <div className="card-body">
          <MemberTable
            members={summary.members}
            medians={summary.medians}
            analyses={summary.analyses}
            onOpen={(m) => onOpen(m.key)}
          />
          <p className={`hint ${styles.note}`}>{C.aiNote}</p>
        </div>
      </section>

      <TeamAnalyses ref={analysesRef} members={summary.members} analyses={summary.analyses} onOpen={onReport} />

      <div className="grid-2">
        <section className="section card pad" aria-label={C.compareTitle}>
          <div className="row">
            <h2 className="section-title grow">{C.compareTitle}</h2>
            <select
              className="select fit"
              aria-label={C.compareMetric}
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
            >
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <CompareBars members={summary.members} medians={summary.medians} metric={metric} />
        </section>
        <section className="section card pad" aria-label={C.directoriesTitle}>
          <h2 className="section-title">{C.directoriesTitle}</h2>
          <p className="hint">{C.directoriesLede}</p>
          <DirectoryShares directories={summary.directories} members={summary.members} />
        </section>
      </div>

      {summary.others.length > 0 && (
        <details className="section card pad" data-testid="team-others">
          <summary className="section-title">{C.othersTitle(summary.others.length)}</summary>
          <p className="hint">{C.othersLede}</p>
          <ul className={styles.others}>
            {summary.others.map((o) => (
              <li key={o.key}>
                <span className="grow">
                  {o.kind === TeamOtherKind.AiTask ? C.aiTask : `${o.name}（${C.hiddenIdentity}）`}
                </span>
                <span>
                  {formatCount(o.metrics.commits)} {C.metric.commits}
                </span>
                <Lines added={o.metrics.added} deleted={o.metrics.deleted} />
                {o.kind === TeamOtherKind.Hidden && (
                  <Button size="sm" variant="ghost" onClick={() => onOpen(o.key)}>
                    {C.open}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
