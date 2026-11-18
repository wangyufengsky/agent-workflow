import {
  AttemptKind,
  DeliveryStrategy,
  FindingSeverity,
  MCP_TOOL_PREFIX,
  McpToolName,
  NodeKind,
  TASK_CODE_REVIEW_NODE_KEY,
  type TaskDetailDTO,
  TaskStatus,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useMemo, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { ARTIFACT_COPY } from '../../copy/artifacts.ts';
import { DELIVERY_COPY } from '../../copy/delivery.ts';
import { TASK_CODE_REVIEW_COPY as C } from '../../copy/task-code-review.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { attemptQuery, attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import { gitDiffQuery } from '../git/git.queries.ts';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import layout from '../preview/frontend-workbench.module.css';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { UnmetNotice, useDeliveryAcknowledgement } from '../requirements/unmet-notice.tsx';
import { nodeQuery, useDeliver } from '../tasks/tasks.queries.ts';
import { findingPosition, type ReviewPosition, reviewReads } from './review-reading.ts';
import { ReviewSource } from './review-source.tsx';
import styles from './task-code-review.module.css';

const severities = [FindingSeverity.Blocker, FindingSeverity.Major, FindingSeverity.Minor] as const;

export function TaskCodeReviewWorkbench({
  task,
  review,
  repo,
  active,
  pro,
  record,
  nodeDetails,
}: {
  task: TaskDetailDTO;
  repo: string;
  active: boolean;
  review: NonNullable<TaskDetailDTO['codeReview']>;
  pro: boolean;
  record: ReactNode;
  nodeDetails?: { title: string; content: ReactNode; onClose: () => void } | undefined;
}) {
  const [severity, setSeverity] = useState<FindingSeverity>();
  const [held, hold] = useState<ReviewPosition | null>();
  const [panel, setPanel] = useState<'activity' | 'record' | 'findings'>('findings');
  const deliver = useDeliver();
  const acknowledgement = useDeliveryAcknowledgement(task.id);
  const reviewing = task.status === TaskStatus.Review;
  const node = task.nodes.findLast((n) => n.key === TASK_CODE_REVIEW_NODE_KEY || n.kind === NodeKind.Revise);
  const live = task.activeAttempts.findLast((a) => a.kind === AttemptKind.Execute || a.kind === AttemptKind.Review);
  const history = useQuery({ ...nodeQuery(task.id, node?.id ?? ''), enabled: active && !!node && !live });
  const id = live?.id ?? history.data?.attempts.findLast((a) => a.kind === AttemptKind.Execute)?.id;
  const attempt = useQuery({ ...attemptQuery(id ?? ''), enabled: active && !!id });
  const transcript = useTranscript(attemptTranscript(id ?? ''), active && !!id);
  const commit = task.git.baseCommit ?? task.git.baseBranch;
  const reads = useMemo(
    () =>
      reviewReads(
        transcript.entries,
        attempt.data?.directory ?? '',
        [task.git.worktreePath ?? '', repo].filter(Boolean),
        commit,
      ),
    [transcript.entries, attempt.data?.directory, task.git.worktreePath, repo, commit],
  );
  const report = review.draft ?? review.report;
  const scope = report?.scope.kind === 'diff' ? report.scope : undefined;
  const changes = useQuery({
    ...gitDiffQuery(task.project.id, scope?.from ?? '', scope?.to ?? ''),
    enabled: active && !!scope,
  });
  const changedFiles = scope
    ? (changes.data?.files ?? []).map((file) => ({
        path: file.path,
        commit: file.status === 'deleted' ? scope.from : scope.to,
      }))
    : [];
  const summary = review.draft ? null : review.summary;
  const ready = review.report !== null || review.summary !== null;
  const lastCall = transcript.entries.findLast((e) => e.kind === 'tool_call');
  const lastFinding = report?.findings.at(-1);
  const reporting =
    lastCall?.kind === 'tool_call' &&
    lastCall.data.tool === MCP_TOOL_PREFIX + McpToolName.ReportProgress &&
    lastCall.data.input.code_review !== undefined;
  const auto = live && !(reporting && lastFinding) ? reads.at(-1) : undefined;
  const initial = live ? lastFinding : report?.findings[0];
  const position: ReviewPosition | null | undefined =
    held === undefined ? (auto ?? (initial && findingPosition(initial)) ?? reads.at(-1) ?? changedFiles[0]) : held;
  const files: ReviewPosition[] = [...changedFiles, ...reads, ...(report?.findings.map(findingPosition) ?? [])];
  const fileKey = (p: ReviewPosition) => JSON.stringify([p.commit, p.path]);
  const options = new Map(files.map((p) => [fileKey(p), p]));
  if (position) options.set(fileKey(position), position);
  const entries = report?.findings.map((item, index) => ({ item, index })) ?? [];
  const visible = entries.filter(({ item }) => severity === undefined || severity === item.severity);
  visible.sort((a, b) => severities.indexOf(a.item.severity) - severities.indexOf(b.item.severity));

  const reportForFix = [
    summary,
    ...entries.map(
      ({ item }) =>
        `- ${item.title} (${C.location(item.location.path, item.line, item.end_line)}): ${item.description}${item.suggestion === undefined ? '' : ` ${item.suggestion}`}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

  function show(next: 'activity' | 'record') {
    nodeDetails?.onClose();
    setPanel(panel === next ? 'findings' : next);
  }

  return (
    <section className={layout.workbench} aria-label={C.title} data-testid="task-code-review">
      <header className={layout.toolbar}>
        <div className={`grow row wrap ${styles.metadata}`}>
          <strong>{task.workflow.name}</strong>
          {options.size > 0 && (
            <select
              className="input"
              aria-label={C.file}
              value={position ? fileKey(position) : ''}
              onChange={(e) => hold(options.get(e.target.value))}
            >
              {[...options].map(([key, p]) => (
                <option key={key} value={key}>
                  {p.path}
                  {scope ? ` · ${p.commit.slice(0, 8)}` : ''}
                </option>
              ))}
            </select>
          )}
          {live && (
            <Button
              size="sm"
              aria-pressed={held === undefined}
              onClick={() => hold(held === undefined ? (position ?? null) : undefined)}
            >
              {held === undefined ? R.pauseRead : R.resumeRead}
            </Button>
          )}
          {report !== null && <span className="mono hint">{C.scope(report.scope)}</span>}
        </div>
        {
          <Button
            size="sm"
            icon="gauge"
            variant="ghost"
            aria-expanded={panel === 'activity'}
            onClick={() => show('activity')}
          >
            {ARTIFACT_COPY.panels.activity}
          </Button>
        }
        <Button size="sm" icon="list" variant="ghost" aria-expanded={panel === 'record'} onClick={() => show('record')}>
          {ARTIFACT_COPY.panels.record}
        </Button>
        {reviewing && ready && (report === null || entries.length > 0) && (
          <Link
            to={ROUTES.home}
            className="btn ghost sm"
            search={{
              projectId: task.project.id,
              workflow: 'bugfix',
              requirement: DELIVERY_COPY.fixRequirement(reportForFix),
            }}
          >
            {DELIVERY_COPY.fixFromReport}
          </Link>
        )}
        {reviewing && (
          <Button
            size="sm"
            icon="check"
            variant="primary"
            disabled={acknowledgement.blocked}
            pending={deliver.isPending}
            onClick={() =>
              deliver.mutate({ id: task.id, strategy: DeliveryStrategy.ReportOnly, ...acknowledgement.ack })
            }
          >
            {C.complete}
          </Button>
        )}
      </header>
      {deliver.isError && <ErrorState error={deliver.error} />}
      {reviewing && <UnmetNotice acknowledgement={acknowledgement} />}
      <div className={layout.body}>
        {position ? (
          <ReviewSource project={task.project.id} position={position} pro={pro} active={active} report={report} />
        ) : (
          <section className={styles.sheet} aria-label={C.code}>
            <div className="hint">
              {ready && summary ? <Markdown source={summary} /> : ready ? C.empty : C.waitRead}
            </div>
          </section>
        )}
        <aside className={layout.inspector} aria-label={nodeDetails?.title ?? C.findings}>
          {nodeDetails ? (
            <>
              <div className={layout.inspectorHead}>
                <h2>{nodeDetails.title}</h2>
                <IconButton icon="x" label={C.close} onClick={nodeDetails.onClose} />
              </div>
              {nodeDetails.content}
            </>
          ) : panel === 'activity' ? (
            <FrontendActivity task={task} inMain={false} starting={false} />
          ) : panel === 'record' ? (
            record
          ) : (
            <>
              <div className={styles.content}>
                {summary !== null && position && (
                  <section className="col" aria-label={C.summary}>
                    <Markdown source={summary} />
                  </section>
                )}
                {report === null ? (
                  <p className="hint">{summary === null ? C.buildingHint : C.legacy}</p>
                ) : (
                  <>
                    <h2>{C.findings}</h2>
                    {entries.length === 0 ? (
                      <p className="hint">{C.clean}</p>
                    ) : (
                      <>
                        <fieldset aria-label={C.findings} className={`row wrap ${styles.filters}`}>
                          <Button
                            size="sm"
                            aria-pressed={severity === undefined}
                            onClick={() => setSeverity(undefined)}
                          >
                            {C.filter(C.all, entries.length)}
                          </Button>
                          {severities.map((level) => (
                            <Button
                              key={level}
                              size="sm"
                              aria-pressed={severity === level}
                              onClick={() => setSeverity(level)}
                            >
                              {C.filter(
                                C.severity[level],
                                entries.filter(({ item }) => item.severity === level).length,
                              )}
                            </Button>
                          ))}
                        </fieldset>
                        {visible.length === 0 && <p className="hint">{C.noMatches}</p>}
                        <ul className={styles.findings}>
                          {visible.map(({ item, index }) => (
                            <li
                              key={index}
                              className={`card ${styles.finding}`}
                              data-selected={
                                held?.path === item.location.path &&
                                held?.line === item.line &&
                                held?.commit === item.location.commit
                              }
                            >
                              <div className="row wrap">
                                <span
                                  className={`badge ${
                                    item.severity === FindingSeverity.Blocker
                                      ? 'st-danger'
                                      : item.severity === FindingSeverity.Major
                                        ? 'st-warn'
                                        : 'st-idle'
                                  }`}
                                >
                                  {C.severity[item.severity]}
                                </span>
                                <span className="hint">{C.category[item.category]}</span>
                              </div>
                              <h3>{item.title}</h3>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="file"
                                className={styles.location}
                                onClick={() => {
                                  hold(findingPosition(item));
                                }}
                              >
                                {C.location(item.location.path, item.line, item.end_line)}
                              </Button>
                              <Markdown source={item.description} />
                              {item.suggestion !== undefined && (
                                <details open={item.severity !== FindingSeverity.Minor}>
                                  <summary>{C.suggestion}</summary>
                                  <Markdown source={item.suggestion} />
                                </details>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
              {live && <FrontendActivity task={task} inMain={false} starting={false} />}
            </>
          )}
        </aside>
      </div>
      {(reviewing || task.status === TaskStatus.Completed) && <RequirementsSection task={task} />}
    </section>
  );
}
