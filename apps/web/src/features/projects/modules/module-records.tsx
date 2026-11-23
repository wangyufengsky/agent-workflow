import type { ProjectModuleRun } from '@aw/shared';
import { formatDateTime } from '../../../copy/common.ts';
import { PROJECT_MODULES_COPY as C } from '../../../copy/project-modules.ts';
import styles from './project-modules.module.css';
import { ServiceRuntimeEvidence } from './service-runtime-evidence.tsx';

type State = ProjectModuleRun['status'] | 'discovered' | 'verified' | 'stale' | 'pending' | 'no_entry';

export function stateTone(state: State) {
  switch (state) {
    case 'verified':
    case 'ready':
    case 'passed':
      return 'ok';
    case 'stale':
    case 'interrupted':
      return 'warn';
    case 'failed':
      return 'danger';
    case 'running':
    case 'starting':
      return 'running';
    default:
      return undefined;
  }
}

export function ModuleState({ state }: { state: State }) {
  return (
    <span className={styles.state} data-tone={stateTone(state)}>
      <span className={styles.kindDot} aria-hidden="true" />
      {C.status[state]}
    </span>
  );
}

export function readinessLine(run: ProjectModuleRun) {
  if (run.readyStatus === null || run.readyUrl === null) return undefined;
  return C.readiness(new URL(run.readyUrl).pathname, run.readyStatus);
}

export function ModuleRecords({ runs }: { runs: readonly ProjectModuleRun[] }) {
  if (runs.length === 0) return <p className="hint">{C.noRecords}</p>;
  return (
    <div className="col">
      <h4>{C.recentRecords}</h4>
      <ul className={styles.recordList}>
        {runs.map((run, index) => (
          <li className={styles.record} key={run.id}>
            <details open={index === 0 || undefined}>
              <summary>
                {C.runKind[run.kind]} · {formatDateTime(run.startedAt)} · <ModuleState state={run.status} />
              </summary>
              <div className="col">
                {readinessLine(run) !== undefined && <p>{readinessLine(run)}</p>}
                {run.readyUrl !== null && <code>{run.readyUrl}</code>}
                {run.services?.length ? (
                  <ServiceRuntimeEvidence services={run.services} initialServiceId={run.targetServiceId} />
                ) : (
                  <pre className={`mono ${styles.log}`}>{run.log || C.noLogs}</pre>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
