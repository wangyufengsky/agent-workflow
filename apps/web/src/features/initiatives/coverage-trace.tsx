import {
  DeliveryStatus,
  DeliveryStrategy,
  type InitiativeCoverage,
  type InitiativeCoverageItemSnapshot,
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

/** 使用拆解时的显式关联。旧记录按工作包展示。 */
export function CoverageTrace({
  initiative,
  line,
  snapshot,
}: {
  initiative: InitiativeDetailDTO;
  line: InitiativeCoverage;
  snapshot?: readonly InitiativeCoverageItemSnapshot[];
}) {
  const query = useQuery(initiativeCoverageQuery(initiative.id));
  if (query.isPending) return <p className="hint">{C.coverageLoading}</p>;
  if (query.isError) return <ErrorState error={query.error} />;
  return (
    <div className={`col ${styles.coverageTrace}`}>
      {line.items.map((key) => {
        const previous = snapshot?.find((entry) => entry.key === key);
        const item = initiative.items.find(
          (entry) => entry.key === key && (snapshot === undefined || entry.id === previous?.id),
        );
        const links = line.links?.filter((entry) => entry.item === key).flatMap((entry) => entry.acceptance) ?? [];
        if (item === undefined)
          return (
            <section key={key} className={`col ${styles.coveragePackage}`}>
              <strong>
                {C.coverageRemoved}: {previous?.title ?? key}
              </strong>
              {previous !== undefined && <SnapshotCriteria snapshot={previous} links={links} />}
            </section>
          );
        const history = query.data.items.find((entry) => entry.key === key)?.tasks ?? [];
        return (
          <section key={key} className="col">
            <strong>
              {item.title} ·{' '}
              {item.status === InitiativeItemStatus.PrOpen && item.lastDelivery?.remoteStatus?.state === 'merged'
                ? C.coverageAwaitConfirmation
                : INITIATIVE_ITEM_STATUS_LABEL[item.status]}
            </strong>
            {item.dropReason !== null && <span>{item.dropReason}</span>}
            {previous !== undefined && <SnapshotCriteria snapshot={previous} links={links} />}
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
                <div className="row">
                  <TaskBadge group={task.displayGroup} archived={task.archivedAt !== null} />
                </div>
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
                      <Link
                        to={ROUTES.task}
                        params={{ taskId: task.id }}
                        search={{
                          requirement: trace.item.id,
                          ...(trace.isCurrent ? {} : { requirementRevision: trace.revisionId }),
                        }}
                      >
                        {trace.item.title}
                      </Link>
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
                  <Link to={ROUTES.task} params={{ taskId: task.id }} search={{ delivery: true }}>
                    {C.coverageLocalCommit(delivery.commitSha)}
                  </Link>
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

/** 历史覆盖使用拆解快照里的验收项和工作包身份。 */
function SnapshotCriteria({ snapshot, links }: { snapshot: InitiativeCoverageItemSnapshot; links: readonly string[] }) {
  if (links.length === 0) return <span className="hint">{C.coveragePackageOnly}</span>;
  if (snapshot.acceptance === undefined) return <span className="hint">{C.coverageSnapshotUnavailable}</span>;
  return (
    <div className="col">
      <span className="hint">{C.coverageSnapshotCriteria}</span>
      {links.map((id) => {
        const criterion = snapshot.acceptance?.find((entry) => entry.id === id);
        if (criterion === undefined) return <span key={id}>{C.coverageSnapshotUnavailable}</span>;
        return (
          <div key={id} className="col">
            <span>{criterion.title}</span>
            <span className="hint">{R.expectedIs(criterion.expected)}</span>
            {snapshot.taskId === null && <span className="hint">{C.coverageSnapshotPending}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** 每个覆盖版本保留原工作包身份，以区分后续复用同一 key 的包。 */
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
