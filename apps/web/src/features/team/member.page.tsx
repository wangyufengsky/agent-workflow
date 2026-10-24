import { type TeamIdentityDTO, type TeamMemberDetailDTO, type TeamQuery, UiMode } from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY, formatTime } from '../../copy/common.ts';
import { TEAM_COPY as C, formatBucket, formatCount, formatRate, WORK_TYPE_LABEL } from '../../copy/team.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { BarChart } from '../insights/bar-chart.tsx';
import chart from '../insights/insights.module.css';
import { projectQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { MemberAnalysis } from './member-analysis.tsx';
import styles from './team.module.css';
import { teamCommitsQuery, teamMemberQuery, teamSummaryQuery, useUpdateIdentity } from './team.queries.ts';
import { Delta, Lines, METRICS, MetricCard, WorkMix } from './team-parts.tsx';
import { type TeamSearch, teamQueryOf } from './team-search.ts';
import { ScanProgress, TeamToolbar } from './team-toolbar.tsx';

const route = getRouteApi(ROUTE_IDS.teamMember);

/** `/team/:projectId/members/:member` (33 §5.3): one member's figures over time, and their commits. */
export function TeamMemberPage() {
  const { projectId, member } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const project = useQuery(projectQuery(projectId));
  const query = teamQueryOf(projectId, search);
  const detail = useQuery(teamMemberQuery(query, member));
  const setTeamProject = useUiStore((s) => s.setTeamProject);
  useEffect(() => setTeamProject(projectId), [setTeamProject, projectId]);

  const onSearch = (change: Partial<TeamSearch>) =>
    void navigate({ to: ROUTES.teamMember, params: { projectId, member }, search: { ...search, ...change } });
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
      <div className="crumbs">
        <Link to={ROUTES.team} params={{ projectId }} search={search}>
          {C.back}
        </Link>
        <span className="sep">/</span>
        <span className="cur">{detail.data?.member.name ?? member}</span>
      </div>
      <TeamToolbar project={project.data} query={query} scope={detail.data} onSearch={onSearch} onProject={onProject} />
      {detail.isPending && <ScanProgress projectId={projectId} />}
      {detail.isError && <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />}
      {detail.data !== undefined && <MemberDetail detail={detail.data} query={query} />}
    </div>
  );
}

function MemberDetail({ detail, query }: { detail: TeamMemberDetailDTO; query: TeamQuery }) {
  const { member, medians } = detail;
  const m = member.metrics;
  const fixShare = m.commits === 0 ? null : m.workMix.fix / m.commits;
  const format = (date: string) => formatBucket(date, detail.granularity);
  const series = {
    commits: { name: C.metric.commits, tone: 's0' as const },
    added: { name: C.metric.added, tone: 's6' as const },
    deleted: { name: C.metric.deleted, tone: 's7' as const },
    test: { name: C.metric.testRate, tone: 's1' as const },
  };
  const at = (b: number) => member.series[b];
  return (
    <>
      <MemberHead detail={detail} query={query} />
      {detail.hidden && <div className="banner info">{C.hiddenBanner}</div>}
      <section className="section" aria-label={C.member}>
        <div className="grid-4" data-testid="member-metrics">
          {METRICS.filter((x) => x.key !== 'added' && x.key !== 'deleted').map((x) => {
            const value = x.get(m);
            const median = medians[x.key];
            return (
              <MetricCard
                key={x.key}
                label={x.label}
                value={value === null ? '—' : x.format(value)}
                delta={<Delta current={value} previous={x.get(member.previous)} />}
                sub={median === null ? undefined : C.medianLine(x.format(median))}
              />
            );
          })}
          <MetricCard
            label={C.metric.lines}
            value={formatCount(m.added + m.deleted)}
            delta={<Delta current={m.added + m.deleted} previous={member.previous.added + member.previous.deleted} />}
            sub={<Lines added={m.added} deleted={m.deleted} />}
          />
          <MetricCard label={C.metric.fixShare} value={formatRate(fixShare)} sub={C.fixNote} />
          <MetricCard label={C.metric.taskCommits} value={formatCount(m.taskCommits)} />
        </div>
        <p className={`hint ${styles.note}`}>
          {C.linesNote}
          {m.hugeCommits > 0 && ` ${C.hugeNote(m.hugeCommits)}。`} {C.aiNote}
        </p>
      </section>

      <div className="grid-2">
        <section className="section card pad" aria-label={C.trendTitle}>
          <h2 className="section-title">{C.metric.commits}</h2>
          <BarChart
            label={C.metric.commits}
            series={[series.commits]}
            days={detail.buckets.map((bucket, b) => ({
              date: bucket.from,
              values: [{ series: series.commits, value: at(b)?.commits ?? 0 }],
            }))}
            format={formatCount}
            formatAxis={formatCount}
            formatDate={format}
            tableCaption={C.trendTable}
          />
        </section>
        <section className="section card pad" aria-label={C.metric.lines}>
          <h2 className="section-title">{C.metric.lines}</h2>
          <BarChart
            label={C.metric.lines}
            series={[series.added, series.deleted]}
            days={detail.buckets.map((bucket, b) => ({
              date: bucket.from,
              values: [
                { series: series.added, value: at(b)?.added ?? 0 },
                { series: series.deleted, value: at(b)?.deleted ?? 0 },
              ],
            }))}
            format={formatCount}
            formatAxis={formatCount}
            formatDate={format}
            tableCaption={C.metric.lines}
          />
        </section>
        <section className="section card pad" aria-label={C.metric.testRate}>
          <h2 className="section-title">{C.metric.testRate}</h2>
          <BarChart
            label={C.metric.testRate}
            series={[series.test]}
            days={detail.buckets.map((bucket, b) => {
              const point = at(b);
              const rate = point === undefined || point.codeCommits === 0 ? 0 : point.testCommits / point.codeCommits;
              return { date: bucket.from, values: [{ series: series.test, value: rate }] };
            })}
            format={(v) => formatRate(v)}
            formatAxis={(v) => formatRate(v)}
            formatDate={format}
            tableCaption={C.metric.testRate}
            max={1}
          />
        </section>
        <section className="section card pad" aria-label={C.workMixTitle}>
          <h2 className="section-title">{C.workMixTitle}</h2>
          <p className="hint">{C.workMixLede}</p>
          <WorkMix metrics={m} />
          <h2 className="section-title">{C.myDirectoriesTitle}</h2>
          <ul className={styles.directories}>
            {detail.directories.map((d) => (
              <li key={d.path}>
                <span className={`mono ${styles.dirPath}`}>{d.path === '' ? C.rootDirectory : d.path}</span>
                <span className={styles.share}>
                  <i
                    className={chart.s0}
                    style={{ width: `${(d.lines / Math.max(1, detail.directories[0]?.lines ?? 1)) * 100}%` }}
                  />
                </span>
                <span className={styles.dirLines}>{formatCount(d.lines)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <MemberAnalysis
        query={query}
        member={member.key}
        name={member.name}
        range={{ from: detail.period.from, to: detail.period.to, ref: detail.ref }}
      />
      <CommitList query={query} member={member.key} />
    </>
  );
}

/** Name, emails and how the identities count (33 §2.3). */
function MemberHead({ detail, query }: { detail: TeamMemberDetailDTO; query: TeamQuery }) {
  const { member } = detail;
  const update = useUpdateIdentity(query.id);
  const [dialog, setDialog] = useState<'merge' | 'rename' | null>(null);
  return (
    <div className="page-head">
      <div className="grow">
        <h1 className="title">{member.name}</h1>
        <ul className={styles.identities} aria-label={C.emails}>
          {detail.identities.map((identity) => (
            <IdentityChip
              key={identity.email}
              identity={identity}
              main={identity.email === member.key}
              onUnmerge={() => update.mutate({ email: identity.email, memberEmail: null })}
            />
          ))}
        </ul>
        {update.isError && <ErrorState error={update.error} />}
      </div>
      <div className="row">
        <Button variant="secondary" onClick={() => setDialog('rename')}>
          {C.rename}
        </Button>
        <Button variant="secondary" onClick={() => setDialog('merge')}>
          {C.mergeInto}
        </Button>
        <Button
          variant="ghost"
          pending={update.isPending}
          onClick={() => update.mutate({ email: member.key, hidden: !detail.hidden })}
        >
          {detail.hidden ? C.unhide : C.hide}
        </Button>
      </div>
      {dialog === 'rename' && <RenameDialog detail={detail} projectId={query.id} onClose={() => setDialog(null)} />}
      {dialog === 'merge' && <MergeDialog detail={detail} query={query} onClose={() => setDialog(null)} />}
    </div>
  );
}

function IdentityChip({
  identity,
  main,
  onUnmerge,
}: {
  identity: TeamIdentityDTO;
  main: boolean;
  onUnmerge: () => void;
}) {
  return (
    <li className="chip">
      <span className="mono">{identity.email}</span>
      {identity.authorName !== identity.email && <span className="sub">{identity.authorName}</span>}
      {!main && identity.memberEmail !== null && (
        <button type="button" className={chart.link} onClick={onUnmerge}>
          {C.unmerge}
        </button>
      )}
    </li>
  );
}

function RenameDialog({
  detail,
  projectId,
  onClose,
}: {
  detail: TeamMemberDetailDTO;
  projectId: string;
  onClose: () => void;
}) {
  const update = useUpdateIdentity(projectId);
  const main = detail.identities.find((i) => i.email === detail.member.key);
  const [name, setName] = useState(main?.displayName ?? detail.member.name);
  const save = () =>
    update.mutate(
      { email: detail.member.key, displayName: name.trim() === '' ? null : name.trim() },
      { onSuccess: onClose },
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.renameTitle}
      description={C.renameLede}
      footer={
        <Button variant="primary" pending={update.isPending} onClick={save}>
          {C.save}
        </Button>
      }
    >
      <input className="input" aria-label={C.renameTitle} value={name} onChange={(e) => setName(e.target.value)} />
      {update.isError && <ErrorState error={update.error} />}
    </Dialog>
  );
}

/** Merge this member into another one of the same person: every identity of it moves (33 §2.3). */
function MergeDialog({
  detail,
  query,
  onClose,
}: {
  detail: TeamMemberDetailDTO;
  query: TeamQuery;
  onClose: () => void;
}) {
  const others = (useQuery(teamSummaryQuery(query)).data?.members ?? []).filter((m) => m.key !== detail.member.key);
  const [target, setTarget] = useState<string>('');
  const update = useUpdateIdentity(query.id);
  const navigate = useNavigate();
  const merge = () =>
    update.mutate(
      { email: detail.member.key, memberEmail: target },
      {
        onSuccess: () =>
          void navigate({ to: ROUTES.teamMember, params: { projectId: query.id, member: target }, search: {} }),
      },
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.mergeTitle(detail.member.name)}
      description={C.mergeLede}
      footer={
        <Button variant="primary" disabled={target === ''} pending={update.isPending} onClick={merge}>
          {C.merge}
        </Button>
      }
    >
      <label className="field">
        <span className="label">{C.mergeTarget}</span>
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="" disabled>
            —
          </option>
          {others.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}（{m.key}）
            </option>
          ))}
        </select>
      </label>
      {update.isError && <ErrorState error={update.error} />}
    </Dialog>
  );
}

/** The member's commits in the period, newest first; pro mode opens them in the Git workbench. */
function CommitList({ query, member }: { query: TeamQuery; member: string }) {
  const commits = useInfiniteQuery(teamCommitsQuery(query, member));
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const items = commits.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="section card" aria-label={C.commitsTitle}>
      <div className="card-head">
        <h2 className="section-title grow">{C.commitsTitle}</h2>
        {pro && <span className="hint">{C.commitsLede}</span>}
      </div>
      <div className="card-body">
        {commits.isError && <ErrorState error={commits.error} onRetry={() => void commits.refetch()} />}
        {commits.data !== undefined && items.length === 0 && <p className="hint">{C.noCommits}</p>}
        {items.length > 0 && (
          <table className={chart.table} data-testid="member-commits">
            <tbody>
              {items.map((c) => (
                <tr key={c.sha}>
                  <td>
                    {pro ? (
                      <Link
                        to={ROUTES.gitProject}
                        params={{ projectId: query.id }}
                        search={{ sha: c.sha, ref: query.ref }}
                      >
                        {c.subject}
                      </Link>
                    ) : (
                      c.subject
                    )}
                    <span className={styles.tags}>
                      <span className="chip">{WORK_TYPE_LABEL[c.workType]}</span>
                      {c.huge && <span className="chip">{C.huge}</span>}
                      {c.reverted && <span className="chip">{C.revertedTag}</span>}
                      {c.viaTask ? (
                        <span className="chip">{C.viaTaskTag}</span>
                      ) : (
                        c.ai && <span className="chip">{C.aiTag}</span>
                      )}
                    </span>
                  </td>
                  <td className="mono hint">{c.sha.slice(0, 7)}</td>
                  <td className="hint nowrap">{formatTime(c.authoredAt)}</td>
                  <td className={chart.num}>
                    <Lines added={c.added} deleted={c.deleted} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {commits.hasNextPage && (
          <Button
            size="sm"
            variant="ghost"
            pending={commits.isFetchingNextPage}
            onClick={() => void commits.fetchNextPage()}
          >
            {C.loadMore}
          </Button>
        )}
      </div>
    </section>
  );
}
