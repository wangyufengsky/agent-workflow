import {
  DeliveryStrategy,
  FindingSeverity,
  type TaskCodeReviewReport,
  type TaskDetailDTO,
  TaskStatus,
  textLines,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { ARTIFACT_COPY } from '../../copy/artifacts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { DELIVERY_COPY } from '../../copy/delivery.ts';
import { GIT_COPY } from '../../copy/git.ts';
import { TASK_CODE_REVIEW_COPY as C } from '../../copy/task-code-review.ts';
import { gitFileQuery } from '../git/git.queries.ts';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import layout from '../preview/frontend-workbench.module.css';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { UnmetNotice, useDeliveryAcknowledgement } from '../requirements/unmet-notice.tsx';
import { useDeliver } from '../tasks/tasks.queries.ts';
import styles from './task-code-review.module.css';

type Finding = TaskCodeReviewReport['findings'][number];
const severities = [FindingSeverity.Blocker, FindingSeverity.Major, FindingSeverity.Minor] as const;

function CodeLocation({ projectId, finding, pro }: { projectId: string; finding: Finding; pro: boolean }) {
  const { commit, path } = finding.location;
  const query = useQuery(gitFileQuery(projectId, commit, path));
  if (query.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const file = query.data;
  if ('binary' in file) return <p className="hint">{GIT_COPY.binary}</p>;
  if ('tooLarge' in file) return <p className="hint">{GIT_COPY.tooLarge(Math.ceil(file.size / 1024))}</p>;
  const lines = textLines(file.content);
  const first = finding.line ?? 1;
  const last = finding.end_line ?? first;
  const start = Math.max(0, first - 7);
  const end = finding.line === undefined ? Math.min(lines.length, 60) : Math.min(last + 6, start + 120);
  return (
    <>
      <div className={`col ${styles.metadata}`}>
        <strong className="mono">{C.location(path, finding.line, finding.end_line)}</strong>
        <span className="mono hint" title={commit}>
          {commit.slice(0, 8)}
        </span>
      </div>
      <pre className={styles.code}>
        <code>
          {lines.slice(start, end).map((source, offset) => {
            const line = start + offset + 1;
            return (
              <span
                key={line}
                className={styles.line}
                data-marked={finding.line !== undefined && line >= first && line <= last}
              >
                <span aria-hidden="true">{line}</span>
                {source}
              </span>
            );
          })}
        </code>
      </pre>
      {pro && (
        <Link
          className="btn ghost sm"
          to={ROUTES.gitProject}
          params={{ projectId }}
          search={{ view: 'files', ref: commit, path, file: true, line: finding.line }}
        >
          {C.openInGit}
        </Link>
      )}
    </>
  );
}

export function TaskCodeReviewWorkbench({
  task,
  review: { report, summary },
  pro,
  record,
  nodeDetails,
}: {
  task: TaskDetailDTO;
  review: NonNullable<TaskDetailDTO['codeReview']>;
  pro: boolean;
  record: ReactNode;
  nodeDetails?: { title: string; content: ReactNode; onClose: () => void } | undefined;
}) {
  const [severity, setSeverity] = useState<FindingSeverity>();
  const [selectedIndex, setSelected] = useState<number>();
  const [panel, setPanel] = useState<'activity' | 'record'>();
  const deliver = useDeliver();
  const acknowledgement = useDeliveryAcknowledgement(task.id);
  const reviewing = task.status === TaskStatus.Review;
  const running = task.status === TaskStatus.Running || task.status === TaskStatus.Preparing;
  const ready = report !== null || summary !== null;
  const finding = selectedIndex === undefined ? undefined : report?.findings[selectedIndex];
  const panelTitle =
    nodeDetails?.title ??
    (finding !== undefined ? C.code : panel === undefined ? undefined : ARTIFACT_COPY.panels[panel]);
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
    setSelected(undefined);
    setPanel(panel === next && finding === undefined && nodeDetails === undefined ? undefined : next);
  }

  return (
    <section className={layout.workbench} aria-label={C.title} data-testid="task-code-review">
      <header className={layout.toolbar}>
        <div className={`grow row wrap ${styles.metadata}`}>
          <strong>{C.title}</strong>
          {report !== null && <span className="mono hint">{C.scope(report.scope)}</span>}
        </div>
        {(!running || ready) && (
          <Button
            size="sm"
            icon="gauge"
            variant="ghost"
            aria-expanded={panel === 'activity'}
            onClick={() => show('activity')}
          >
            {ARTIFACT_COPY.panels.activity}
          </Button>
        )}
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
        {running && !ready ? (
          <FrontendActivity
            task={task}
            inMain
            starting={false}
            buildingTitle={C.building}
            buildingHint={C.buildingHint}
          />
        ) : (
          <div className={styles.sheet}>
            <div className={styles.content}>
              {summary !== null && (
                <section className="col" aria-label={C.summary}>
                  <Markdown source={summary} />
                </section>
              )}
              {report === null ? (
                <p className="hint">{summary === null ? C.empty : C.legacy}</p>
              ) : (
                <>
                  <h2>{C.findings}</h2>
                  {entries.length === 0 ? (
                    <p className="hint">{C.clean}</p>
                  ) : (
                    <>
                      <fieldset aria-label={C.findings} className={`row wrap ${styles.filters}`}>
                        <Button size="sm" aria-pressed={severity === undefined} onClick={() => setSeverity(undefined)}>
                          {C.filter(C.all, entries.length)}
                        </Button>
                        {severities.map((level) => (
                          <Button
                            key={level}
                            size="sm"
                            aria-pressed={severity === level}
                            onClick={() => setSeverity(level)}
                          >
                            {C.filter(C.severity[level], entries.filter(({ item }) => item.severity === level).length)}
                          </Button>
                        ))}
                      </fieldset>
                      {visible.length === 0 && <p className="hint">{C.noMatches}</p>}
                      <ul className={styles.findings}>
                        {visible.map(({ item, index }) => (
                          <li key={index} className={`card ${styles.finding}`} data-selected={index === selectedIndex}>
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
                              aria-expanded={finding === item && nodeDetails === undefined}
                              onClick={() => {
                                nodeDetails?.onClose();
                                setPanel(undefined);
                                setSelected(index === selectedIndex && nodeDetails === undefined ? undefined : index);
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
          </div>
        )}
        {panelTitle !== undefined && (
          <aside className={layout.inspector} aria-label={panelTitle}>
            <div className={layout.inspectorHead}>
              <h2>{panelTitle}</h2>
              <IconButton
                icon="x"
                label={C.close}
                onClick={
                  nodeDetails?.onClose ??
                  (() => {
                    setPanel(undefined);
                    setSelected(undefined);
                  })
                }
              />
            </div>
            {nodeDetails !== undefined ? (
              nodeDetails.content
            ) : finding !== undefined ? (
              <CodeLocation projectId={task.project.id} finding={finding} pro={pro} />
            ) : panel === 'record' ? (
              record
            ) : (
              <FrontendActivity task={task} inMain={false} starting={false} />
            )}
          </aside>
        )}
      </div>
      {(reviewing || task.status === TaskStatus.Completed) && <RequirementsSection task={task} />}
    </section>
  );
}
