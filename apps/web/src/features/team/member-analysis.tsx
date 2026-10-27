import {
  FindingSeverity,
  TEAM_ANALYSIS_SAMPLE,
  type TeamAnalysisDTO,
  TeamAnalysisStatus,
  type TeamMemberDTO,
  type TeamQuery,
  type TeamSummaryDTO,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { type Ref, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { formatTime } from '../../copy/common.ts';
import { GIT_COPY } from '../../copy/git.ts';
import { TEAM_COPY as C, formatDecimal } from '../../copy/team.ts';
import { AttemptQueueNotice } from '../attempts/model-slots.tsx';
import git from '../git/git.module.css';
import styles from './team.module.css';
import { teamAnalysesQuery, useCancelAnalysis, useCreateAnalyses } from './team.queries.ts';

const ACTIVE: readonly TeamAnalysisStatus[] = [TeamAnalysisStatus.Queued, TeamAnalysisStatus.Running];
const short = (sha: string) => sha.slice(0, 7);
/** The member page's hash that scrolls to its AI analysis. */
export const ANALYSIS_HASH = 'analysis';

/** Asks before analyses start: they send the members' code to the model (33 §6.6). */
function AnalyseDialog({
  title,
  query,
  members,
  onClose,
  onStarted,
}: {
  title: string;
  query: TeamQuery;
  members: string[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const create = useCreateAnalyses(query);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={C.analyseBody(TEAM_ANALYSIS_SAMPLE)}
      footer={
        <Button
          variant="primary"
          pending={create.isPending}
          onClick={() => create.mutate(members, { onSuccess: onStarted })}
        >
          {C.analyseStart}
        </Button>
      }
    >
      <p className="hint">{C.analysePrivacy}</p>
      {create.isError && <ErrorState error={create.error} />}
    </Dialog>
  );
}

/** 「为全部成员生成分析」 on the team page (33 §5.2 ⑨); `onStarted` shows where the analyses appear. */
export function AnalyseAllButton({
  query,
  members,
  onStarted,
}: {
  query: TeamQuery;
  members: string[];
  onStarted: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon="sparkle" disabled={members.length === 0} onClick={() => setOpen(true)}>
        {C.analyseAll}
      </Button>
      {open && (
        <AnalyseDialog
          title={C.analyseAllTitle(members.length)}
          query={query}
          members={members}
          onClose={() => setOpen(false)}
          onStarted={() => {
            setOpen(false);
            onStarted();
          }}
        />
      )}
    </>
  );
}

/** The team's AI analyses of the shown range (33 §5.2 ⑨): where each member's stands, and the way to its report. */
export function TeamAnalyses({
  members,
  analyses,
  onOpen,
  ref,
}: {
  members: readonly TeamMemberDTO[];
  analyses: TeamSummaryDTO['analyses'];
  onOpen: (member: string) => void;
  ref: Ref<HTMLElement>;
}) {
  const analysisOf = new Map(analyses.map((a) => [a.member, a]));
  const listed = members.filter((m) => m.metrics.commits > 0 || analysisOf.has(m.key));
  const active = analyses.filter((a) => ACTIVE.includes(a.status)).length;
  return (
    <section ref={ref} className="section card" aria-label={C.analysisTitle} data-testid="team-analyses">
      <div className="card-head">
        <h2 className="section-title grow">{C.analysisTitle}</h2>
        {active > 0 && <span className="hint">{C.analysesProgress(analyses.length - active, analyses.length)}</span>}
      </div>
      <div className="card-body">
        <p className="hint">{analyses.length === 0 ? C.analysesEmpty : C.analysesLede}</p>
        <ul className={styles.analyses}>
          {listed.map((member) => {
            const analysis = analysisOf.get(member.key);
            return (
              <li key={member.key}>
                <span className="grow">{member.name}</span>
                {analysis === undefined ? (
                  <span className="hint">{C.notAnalysed}</span>
                ) : (
                  <>
                    {analysis.quality !== null && (
                      <span className={styles.quality}>
                        {C.qualityCell(analysis.quality.blocker, analysis.quality.major, analysis.quality.minor)}
                      </span>
                    )}
                    <span className="chip">{C.analysisStatus[analysis.status]}</span>
                    <Button size="sm" variant="ghost" onClick={() => onOpen(member.key)}>
                      {C.openReport}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** The member's AI analyses (33 §5.3 ⑥): the one of the shown range first, its report, and the earlier ones. */
export function MemberAnalysis({
  query,
  member,
  name,
  range,
  hasCommits,
}: {
  query: TeamQuery;
  member: string;
  name: string;
  range: { from: string; to: string; ref: string };
  /** Without commits in the range there is nothing to analyse. */
  hasCommits: boolean;
}) {
  const analyses = useQuery(teamAnalysesQuery(query.id, member));
  const cancel = useCancelAnalysis(query.id);
  const [asking, setAsking] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const items = analyses.data ?? [];
  const ofRange = items.filter((a) => a.from === range.from && a.to === range.to && a.ref === range.ref);
  const shown = items.find((a) => a.id === chosen) ?? ofRange[0];
  const busy = ofRange.some((a) => ACTIVE.includes(a.status));
  const hash = useLocation({ select: (location) => location.hash });
  const section = useRef<HTMLElement>(null);
  // Arriving from the team page's「查看报告」: the report, not the top of the page.
  useEffect(() => {
    if (hash === ANALYSIS_HASH) section.current?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <section ref={section} className="section card" aria-label={C.analysisTitle} data-testid="member-analysis">
      <div className="card-head">
        <h2 className="section-title grow">{C.analysisTitle}</h2>
        <Button variant="secondary" icon="sparkle" disabled={busy || !hasCommits} onClick={() => setAsking(true)}>
          {shown === undefined ? C.analyse : C.reanalyse}
        </Button>
      </div>
      <div className="card-body col">
        <p className="hint">{hasCommits ? C.analysisLede : C.nothingToAnalyse}</p>
        {analyses.isError && <ErrorState error={analyses.error} onRetry={() => void analyses.refetch()} />}
        {cancel.isError && <ErrorState error={cancel.error} />}
        {analyses.data !== undefined && shown === undefined && <p className="hint">{C.noAnalysis}</p>}
        {shown !== undefined && <Report analysis={shown} onCancel={() => cancel.mutate(shown.id)} />}
        {items.length > 1 && (
          <label className={`field ${styles.history}`}>
            <span className="label">{C.history}</span>
            <select className="select fit" value={shown?.id ?? ''} onChange={(e) => setChosen(e.target.value)}>
              {items.map((a) => (
                <option key={a.id} value={a.id}>
                  {C.analysisOf(a.from, a.to, a.ref)} · {C.analysisStatus[a.status]} · {formatTime(a.createdAt)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {asking && (
        <AnalyseDialog
          title={C.analyseTitle(name)}
          query={query}
          members={[member]}
          onClose={() => setAsking(false)}
          onStarted={() => setAsking(false)}
        />
      )}
    </section>
  );
}

function Commits({ shas }: { shas: readonly string[] }) {
  return (
    <span className={styles.shas}>
      {shas.map((sha) => (
        <code key={sha} className="mono" title={sha}>
          {short(sha)}
        </code>
      ))}
    </span>
  );
}

function Report({ analysis, onCancel }: { analysis: TeamAnalysisDTO; onCancel: () => void }) {
  const { report, quality } = analysis;
  return (
    <div className="col" data-testid="analysis-report">
      <div className="row">
        <span className="chip">{C.analysisStatus[analysis.status]}</span>
        <span className="hint grow">{C.analysisOf(analysis.from, analysis.to, analysis.ref)}</span>
        {ACTIVE.includes(analysis.status) && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {C.cancelAnalysis}
          </Button>
        )}
      </div>
      {analysis.status === TeamAnalysisStatus.Running && analysis.attemptId !== null && (
        <AttemptQueueNotice attemptId={analysis.attemptId} />
      )}
      {analysis.error !== null && <ErrorState error={analysis.error} />}
      {report !== null && (
        <>
          <Markdown source={report.summary} />
          <h3 className={styles.reportHead}>{C.workItems}</h3>
          <ul className={styles.reportList}>
            {report.work_items.map((w) => (
              <li key={w.title}>
                <b>{w.title}</b> <Commits shas={w.commits} />
                <Markdown source={w.description} />
              </li>
            ))}
          </ul>
          {report.strengths.length > 0 && (
            <>
              <h3 className={styles.reportHead}>{C.strengths}</h3>
              <ul className={styles.reportList}>
                {report.strengths.map((s) => (
                  <li key={s.text}>
                    {s.text} <Commits shas={s.commits} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.concerns.length > 0 && (
            <>
              <h3 className={styles.reportHead}>{C.concerns}</h3>
              <ul className={styles.reportList}>
                {report.concerns.map((s) => (
                  <li key={s.text}>
                    {s.text} <Commits shas={s.commits} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className={styles.reportHead}>
            {analysis.sample.length === 0
              ? C.noSample
              : C.findingsTitle(analysis.sample.length, quality?.sampledLines ?? 0)}
          </h3>
          {quality?.perKloc != null && (
            <p className="hint">
              {C.qualityCell(quality.blocker, quality.major, quality.minor)}（
              {C.perKloc(formatDecimal(quality.perKloc.blocker + quality.perKloc.major + quality.perKloc.minor))}）·{' '}
              {C.sampleNote}
            </p>
          )}
          {analysis.sample.length > 0 && report.findings.length === 0 && <p className="hint">{C.noFindings}</p>}
          {report.findings.map((f) => (
            <div
              key={`${f.commit}${f.path}${f.line ?? ''}${f.title}`}
              className={`card ${git.finding} ${styles.findingCard}`}
            >
              <div className={git.findingTitle}>
                <span className={git.severity} data-severity={f.severity}>
                  {GIT_COPY.severity[f.severity]}
                </span>
                <span className={git.category}>{GIT_COPY.category[f.category]}</span>
                <b>
                  <Markdown inline source={f.title} />
                </b>
              </div>
              <div className={git.findingBody}>
                <span className="mono hint">
                  {short(f.commit)} · {f.path}
                  {f.line === undefined ? '' : `:${f.line}`}
                </span>
                <Markdown source={f.description} />
                {f.suggestion !== undefined && (
                  <details className={git.suggestion} open={f.severity !== FindingSeverity.Minor}>
                    <summary>{GIT_COPY.suggestion}</summary>
                    <Markdown source={f.suggestion} />
                  </details>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
