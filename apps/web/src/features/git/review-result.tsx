import {
  DesignKnowledgeMatch,
  DesignStalenessState,
  DiffSide,
  ErrorCode,
  FindingSeverity,
  type GitFindingDTO,
  GitFindingStatus,
  type GitImpactItemDTO,
  type GitReviewDTO,
  GitReviewTarget,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { GIT_COPY as C } from '../../copy/git.ts';
import { GIT_REVIEW_COPY as R } from '../../copy/git-review.ts';
import { designQuery, designStalenessQuery } from '../designs/designs.queries.ts';
import styles from './git.module.css';
import { gitReviewQuery, useUpdateGitFindingStatus } from './git.queries.ts';
import { severityCounts } from './git-parts.tsx';
import { type EvidenceLocation, ReviewEvidenceDialog } from './review-evidence-dialog.tsx';
import { ReviewExportDialog } from './review-export-dialog.tsx';
import { ReviewImpacts } from './review-impacts.tsx';
import report from './review-result.module.css';

const SEVERITIES = [FindingSeverity.Blocker, FindingSeverity.Major, FindingSeverity.Minor] as const;
const bySeverity = (a: GitFindingDTO, b: GitFindingDTO) =>
  SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

const location = (f: GitFindingDTO) =>
  f.line === undefined ? f.path : `${f.path}:${f.line}${f.end_line === undefined ? '' : `-${f.end_line}`}`;

/** The requirement 「据此修复」 prefills (27 §4.6): each chosen finding with its place and suggestion. */
function fixRequirement(review: GitReviewDTO, findings: readonly GitFindingDTO[]): string {
  const items = findings.map(
    (f, i) =>
      `${i + 1}. [${C.severity[f.severity]}] ${f.title}（${location(f)}）\n   ${f.description}${
        f.suggestion === undefined ? '' : `\n   ${C.suggestion}：${f.suggestion}`
      }`,
  );
  return C.fixRequirement(review.label, items.join('\n'));
}

function Verdict({ review }: { review: GitReviewDTO }) {
  const counts = severityCounts(review);
  const serious = counts.blocker + counts.major > 0;
  const categories = [...new Set(review.findings.map((f) => f.category))];
  return (
    <div className={`card ${styles.verdict}`} data-testid="git-review-verdict">
      <div className="row">
        <span className={`badge ${serious ? 'st-warn' : review.findings.length > 0 ? 'st-idle' : 'st-ok'}`}>
          <Icon name={serious ? 'alert' : 'check'} size="sm" />
          {serious ? C.verdictIssues : review.findings.length > 0 ? C.verdictMinor : C.verdictClean}
        </span>
        {review.model !== null && <span className={styles.reviewMeta}>{review.model}</span>}
      </div>
      {review.summary !== null && (
        <div className={styles.lead}>
          <Markdown source={review.summary} />
        </div>
      )}
      <div className={styles.sevRow}>
        {SEVERITIES.map((s) => (
          <div key={s} className={styles.sev}>
            <b>{counts[s]}</b>
            <span>
              <i className={styles.sevDot} data-severity={s} />
              {C.severity[s]}
            </span>
          </div>
        ))}
      </div>
      {categories.length > 0 && (
        <div className={styles.cats}>
          {categories.map((cat) => (
            <span key={cat} className={styles.category}>
              {C.category[cat]} {review.findings.filter((f) => f.category === cat).length}
            </span>
          ))}
        </div>
      )}
      <div className={styles.reviewMeta}>
        <Icon name="info" size="sm" />
        <span className="mono">{C.scope(review.from, review.to)}</span>· {C.scopeFiles(review.files.length)}
        {review.focus !== null && <span>· {C.focusIs(review.focus)}</span>}
      </div>
    </div>
  );
}

function Finding({
  finding,
  chosen,
  onChoose,
  onLocate,
  disabled,
  onStatus,
  impacts,
  onImpact,
}: {
  finding: GitFindingDTO;
  chosen: boolean;
  onChoose: (chosen: boolean) => void;
  onLocate: () => void;
  disabled: boolean;
  onStatus: (status: GitFindingStatus) => void;
  impacts: readonly GitImpactItemDTO[];
  onImpact: (id: string) => void;
}) {
  return (
    <div className={`card ${styles.finding}`} data-testid="git-finding">
      <input type="checkbox" aria-label={finding.title} checked={chosen} onChange={(e) => onChoose(e.target.checked)} />
      <div className={styles.findingTitle}>
        <span className={styles.severity} data-severity={finding.severity}>
          {C.severity[finding.severity]}
        </span>
        <span className={styles.category}>{C.category[finding.category]}</span>
        <b>
          <Markdown inline source={finding.title} />
        </b>
      </div>
      <div className={styles.findingBody}>
        <button type="button" className={styles.location} onClick={onLocate}>
          <Icon name="file" size="sm" />
          {location(finding)}
        </button>
        <div className="row wrap">
          <select
            className="select fit"
            aria-label={R.findingStatus(finding.title)}
            disabled={disabled}
            value={finding.status}
            onChange={(event) => {
              const next = Object.values(GitFindingStatus).find((status) => status === event.currentTarget.value);
              if (next !== undefined) onStatus(next);
            }}
          >
            {Object.values(GitFindingStatus).map((status) => (
              <option key={status} value={status}>
                {R.status[status]}
              </option>
            ))}
          </select>
          {impacts.map((impact) => (
            <button key={impact.id} type="button" className={report.impactLink} onClick={() => onImpact(impact.id)}>
              {impact.title}
            </button>
          ))}
        </div>
        <Markdown source={finding.description} />
        {finding.suggestion !== undefined && (
          <details className={styles.suggestion} open={finding.severity !== FindingSeverity.Minor}>
            <summary>{C.suggestion}</summary>
            <Markdown source={finding.suggestion} />
          </details>
        )}
      </div>
    </div>
  );
}

const Tab = {
  Overview: 'overview',
  Findings: 'findings',
  Impacts: 'impacts',
  Regression: 'regression',
} as const;

function ReviewDesign({ review, projectId }: { review: GitReviewDTO; projectId: string }) {
  const linked = useQuery({ ...designQuery(review.designId ?? ''), enabled: review.designId !== null });
  const staleness = useQuery({
    ...designStalenessQuery(review.designId ?? ''),
    enabled: linked.isSuccess && linked.data.projectId !== null,
  });
  const missing = review.designMatch === DesignKnowledgeMatch.Missing;
  const deleted =
    !missing &&
    (review.designId === null || (linked.error instanceof ApiError && linked.error.code === ErrorCode.DesignNotFound));
  return (
    <div className={report.design} data-match={review.designMatch}>
      <div className="row wrap">
        <Icon name={deleted || missing ? 'info' : 'layers'} size="sm" />
        <strong>{deleted ? R.designDeleted : R.match[review.designMatch]}</strong>
        {review.designSnapshotSha !== null && (
          <span className="badge mono" title={review.designSnapshotSha}>
            {review.designSnapshotSha.slice(0, 10)}
          </span>
        )}
        {linked.data && <span>{linked.data.title}</span>}
        {!deleted && staleness.data?.state === DesignStalenessState.Stale && (
          <span className="badge st-warn">{R.designStaleNow}</span>
        )}
      </div>
      {missing && (
        <Link to={ROUTES.designNew} search={{ projectId }}>
          {R.newDesign}
        </Link>
      )}
      {review.designId !== null && !deleted && (
        <Link to={ROUTES.designWorkbench} params={{ designId: review.designId }}>
          {R.openDesign}
        </Link>
      )}
    </div>
  );
}

export function ReviewResult({
  projectId,
  review,
  onLocate,
}: {
  projectId: string;
  review: GitReviewDTO;
  onLocate: ((finding: GitFindingDTO) => void) | undefined;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<string>(Tab.Overview);
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [impactId, setImpactId] = useState<string>();
  const [evidence, setEvidence] = useState<EvidenceLocation>();
  const [exportOpen, setExportOpen] = useState(false);
  const mutation = useUpdateGitFindingStatus(projectId, review.id);
  const findings = review.findings.toSorted(bySeverity);
  const checks = [
    ...new Set([...review.regressionChecks, ...review.impacts.flatMap((impact) => impact.suggestedChecks)]),
  ];
  const isChosen = (f: GitFindingDTO) =>
    choices.get(f.id) ??
    (f.severity !== FindingSeverity.Minor &&
      (f.status === GitFindingStatus.Open || f.status === GitFindingStatus.Accepted));
  const chosen = findings.filter(isChosen);
  const cannotFixWorktree = review.target === GitReviewTarget.Worktree;
  const canFix = chosen.length > 0 && !cannotFixWorktree;
  const worktree = useQuery({
    ...gitReviewQuery(review.id),
    enabled: cannotFixWorktree,
    refetchOnWindowFocus: 'always',
  });
  const impactFocus = useRef<HTMLElement>(null);
  const focusImpact = (id: string) => {
    if (tab === Tab.Impacts && id === impactId) {
      impactFocus.current?.focus({ preventScroll: true });
      impactFocus.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    setImpactId(id);
    setTab(Tab.Impacts);
  };
  const locateFinding = (finding: GitFindingDTO) => {
    if (onLocate === undefined || !review.files.some((file) => file.path === finding.path)) {
      setEvidence({
        path: finding.path,
        line: finding.line,
        end: finding.end_line,
        side: finding.side ?? DiffSide.New,
      });
    } else onLocate(finding);
  };
  const fix = () =>
    void navigate({
      to: ROUTES.home,
      search: { projectId, workflow: 'bugfix', requirement: fixRequirement(review, chosen) },
    });

  return (
    <>
      <div className={report.toolbar}>
        <Button size="sm" onClick={() => setExportOpen(true)}>
          {R.export}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon="sparkle"
          disabled={!canFix}
          title={cannotFixWorktree ? C.fixNeedsCommit : undefined}
          onClick={fix}
        >
          {C.fixFromReview}
          {chosen.length > 0 ? ` (${chosen.length})` : ''}
        </Button>
      </div>
      {worktree.data?.worktreeChanged === true && (
        <p className="banner warn" role="status">
          {R.worktreeDrift}
        </p>
      )}
      <ReviewDesign review={review} projectId={projectId} />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          setImpactId(undefined);
        }}
        items={[
          {
            value: Tab.Overview,
            label: R.overview,
            content: (
              <div className={report.stack}>
                <div className={report.target}>
                  <span className="badge">{C.targetLabel[review.target]}</span>
                  <strong className="mono">{review.label}</strong>
                </div>
                <Verdict review={review} />
              </div>
            ),
          },
          {
            value: Tab.Impacts,
            label: R.tabCount(R.impacts, review.impacts.length),
            content: (
              <ReviewImpacts
                review={review}
                activeId={impactId}
                activeRef={impactFocus}
                onImpact={focusImpact}
                onEvidence={setEvidence}
              />
            ),
          },
          {
            value: Tab.Findings,
            label: R.tabCount(R.findings, findings.length),
            content: (
              <div className={report.stack}>
                {mutation.isError && <ErrorState error={mutation.error} />}
                {findings.length === 0 ? (
                  <p className="hint">{R.noFindings}</p>
                ) : (
                  <>
                    {findings.map((finding) => (
                      <Finding
                        key={finding.id}
                        finding={finding}
                        chosen={isChosen(finding)}
                        onChoose={(on) => setChoices((previous) => new Map(previous).set(finding.id, on))}
                        onLocate={() => locateFinding(finding)}
                        disabled={mutation.isPending}
                        onStatus={(status) => mutation.mutate({ findingId: finding.id, status })}
                        impacts={review.impacts.filter((impact) => finding.affectedImpactIds?.includes(impact.id))}
                        onImpact={focusImpact}
                      />
                    ))}
                    <div className={styles.fixBar}>
                      <b>{C.selectedFindings(chosen.length)}</b>
                      <span className="hint grow">{cannotFixWorktree ? C.fixNeedsCommit : C.fixHint}</span>
                    </div>
                  </>
                )}
              </div>
            ),
          },
          {
            value: Tab.Regression,
            label: R.tabCount(R.regression, checks.length),
            content: (
              <div className={`card ${report.checks}`}>
                {checks.length === 0 ? (
                  <p className="hint">{R.noChecks}</p>
                ) : (
                  <ul>
                    {checks.map((check) => (
                      <li key={check}>
                        <Markdown inline source={check} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
        ]}
      />
      {evidence !== undefined && (
        <ReviewEvidenceDialog review={review} location={evidence} close={() => setEvidence(undefined)} />
      )}
      {exportOpen && <ReviewExportDialog reviewId={review.id} close={() => setExportOpen(false)} />}
    </>
  );
}
