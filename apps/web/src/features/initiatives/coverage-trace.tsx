import {
  DeliveryStatus,
  DeliveryStrategy,
  type InitiativeCoverage,
  type InitiativeDetailDTO,
  InitiativeItemStatus,
  RequirementDisplayStatus,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { INITIATIVES_COPY as C, INITIATIVE_ITEM_STATUS_LABEL } from '../../copy/initiatives.ts';
import { REQUIREMENTS_COPY as R } from '../../copy/requirements.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import styles from './initiatives.module.css';
import { initiativeCoverageQuery } from './initiatives.queries.ts';

/** The exact links supplied by the breakdown; legacy lines remain at work-package granularity. */
export function CoverageTrace({
  initiative,
  line,
  snapshot,
}: {
  initiative: InitiativeDetailDTO;
  line: InitiativeCoverage;
  snapshot?: ReadonlyArray<{ id: string; key: string; title: string }>;
}) {
  const query = useQuery(initiativeCoverageQuery(initiative.id));
  if (query.isPending) return <p className="hint">{C.coverageLoading}</p>;
  if (query.isError) return <ErrorState error={query.error} />;
  return (
    <div className="col">
      {line.items.map((key) => {
        const previous = snapshot?.find((entry) => entry.key === key);
        const item = initiative.items.find(
          (entry) => entry.key === key && (snapshot === undefined || entry.id === previous?.id),
        );
        if (item === undefined)
          return (
            <p key={key}>
              {C.coverageRemoved}: {previous?.title ?? key}
            </p>
          );
        const history = query.data.items.find((entry) => entry.key === key)?.tasks ?? [];
        const links = line.links?.filter((entry) => entry.item === key).flatMap((entry) => entry.acceptance) ?? [];
        return (
          <section key={key} className="col">
            <strong>
              {item.title} ·{' '}
              {item.status === InitiativeItemStatus.PrOpen && item.lastDelivery?.remoteStatus?.state === 'merged'
                ? C.coverageAwaitConfirmation
                : INITIATIVE_ITEM_STATUS_LABEL[item.status]}
            </strong>
            {item.dropReason !== null && <span>{item.dropReason}</span>}
            {links.length === 0 && <span className="hint">{C.coveragePackageOnly}</span>}
            {history.length === 0 && <span className="hint">{C.coverageNoTask}</span>}
            {history.length === 0 &&
              links.map((id) => {
                const acceptance = item.acceptance.find((entry) => entry.id === id);
                return (
                  <span key={id}>
                    {acceptance === undefined
                      ? C.coverageRemovedAcceptance
                      : `${acceptance.title} · ${R.statusLabel[RequirementDisplayStatus.Unverified]}`}
                  </span>
                );
              })}
            {history.map(({ task, delivery, commitSha, requirements }) => (
              <div className="col" key={task.id}>
                <Link to={ROUTES.task} params={{ taskId: task.id }}>
                  {task.id === item.task?.id ? C.coverageCurrent : C.coveragePrevious} · {task.key} · {task.title}
                </Link>
                <TaskBadge group={task.displayGroup} archived={task.archivedAt !== null} />
                {links.map((key) => {
                  const acceptance = item.acceptance.find((entry) => entry.id === key);
                  const trace = requirements.find((entry) => entry.item.id === key);
                  if (trace === undefined)
                    return (
                      <span key={key}>
                        {acceptance === undefined
                          ? C.coverageRemovedAcceptance
                          : `${C.coverageNoAcceptance}: ${acceptance.title}`}
                      </span>
                    );
                  return (
                    <div className="col" key={key}>
                      <a
                        href={`/tasks/${encodeURIComponent(task.id)}?requirement=${encodeURIComponent(trace.item.id)}${trace.isCurrent ? '' : `&requirementRevision=${encodeURIComponent(trace.revisionId)}`}`}
                      >
                        {trace.item.title}
                      </a>
                      <span>{trace.isCurrent ? R.statusLabel[trace.status] : C.coverageRemovedVersion}</span>
                      {commitSha === null && trace.latest !== null && (
                        <span className="hint">{C.coverageCommitUnknown}</span>
                      )}
                      {trace.latest !== null && (
                        <>
                          <span className="hint">
                            {R.sourceLabel[trace.latest.source]} ·{' '}
                            {R.resultVersion(trace.latest.revisionId, trace.latest.commitSha)}
                          </span>
                          {trace.latest.note !== '' && <p>{trace.latest.note}</p>}
                          {trace.latest.output !== null && (
                            <>
                              <span>{C.coverageOutput}</span>
                              <pre className={styles.coverageOutput}>{trace.latest.output}</pre>
                            </>
                          )}
                          {trace.latest.nodeId != null && (
                            <Link
                              to={ROUTES.node}
                              params={{ taskId: task.id, nodeId: trace.latest.nodeId }}
                              search={{}}
                            >
                              {C.coverageEvidence}
                            </Link>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                {delivery === null ? (
                  <span className="hint">{C.coverageDeliveryPending}</span>
                ) : delivery.status === DeliveryStatus.Running ? (
                  <span>{C.coverageDelivering}</span>
                ) : delivery.status !== DeliveryStatus.Succeeded ? (
                  <span>{C.coverageDeliveryFailed}</span>
                ) : delivery.strategy === DeliveryStrategy.PullRequest && delivery.prUrl !== null ? (
                  <span>
                    <ExternalLink href={delivery.prUrl}>{C.coverageRemote}</ExternalLink> ·{' '}
                    {delivery.remoteError !== null && `${C.coverageRemoteRefreshFailed} · `}
                    {delivery.remoteStatus === null
                      ? C.coverageRemoteUnknown
                      : delivery.remoteStatus.state === 'merged'
                        ? C.coverageRemoteMerged
                        : delivery.remoteStatus.state === 'closed'
                          ? C.coverageRemoteClosed
                          : delivery.remoteStatus.state === 'locked'
                            ? C.coverageRemoteLocked
                            : C.coverageRemoteOpen}
                  </span>
                ) : delivery.commitSha !== null && delivery.diffBase !== null && delivery.diffHead !== null ? (
                  <a href={`/tasks/${encodeURIComponent(task.id)}?delivery=true`}>
                    {C.coverageLocalCommit(delivery.commitSha)}
                  </a>
                ) : delivery.commitSha !== null ? (
                  <Link
                    to={ROUTES.gitProject}
                    params={{ projectId: initiative.project.id }}
                    search={{ view: 'commits', ref: delivery.targetBranch, sha: delivery.commitSha }}
                  >
                    {C.coverageLocalCommit(delivery.commitSha)}
                  </Link>
                ) : delivery.strategy === DeliveryStrategy.ReportOnly ? (
                  <span>{C.coverageReportDelivered}</span>
                ) : (
                  <span>{C.coverageCommitUnavailable}</span>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Earlier submitted breakdowns keep their own package identities, even if a key is reused later. */
export function CoverageHistory({ initiative }: { initiative: InitiativeDetailDTO }) {
  const query = useQuery(initiativeCoverageQuery(initiative.id));
  if (!query.isSuccess || query.data.versions.length < 2) return null;
  return (
    <details>
      <summary>{C.coverageHistory}</summary>
      {query.data.versions.slice(1).map((version) => (
        <details key={version.revision}>
          <summary>{C.coverageVersion(version.revision)}</summary>
          {version.coverage.map((line) => (
            <details key={line.point}>
              <summary>{line.point}</summary>
              {line.items.length === 0 ? (
                <p>{C.coverageNone}</p>
              ) : (
                <CoverageTrace initiative={initiative} line={line} snapshot={version.items} />
              )}
            </details>
          ))}
        </details>
      ))}
    </details>
  );
}
