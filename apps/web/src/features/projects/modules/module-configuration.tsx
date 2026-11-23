import type { ProjectJavaModule, ProjectModuleConfiguration, ProjectModuleRun } from '@aw/shared';
import { Icon } from '../../../components/icon.tsx';
import { formatDateTime } from '../../../copy/common.ts';
import { PROJECT_MODULES_COPY as C } from '../../../copy/project-modules.ts';
import { readinessLine } from './module-records.tsx';
import styles from './project-modules.module.css';

export function ModuleConfiguration({
  module,
  configuration,
  isDefault,
  run,
  verified,
  onSelect,
  onViewRecord,
}: {
  module: ProjectJavaModule;
  configuration: ProjectModuleConfiguration | undefined;
  isDefault: boolean;
  run: ProjectModuleRun | undefined;
  verified: boolean;
  onSelect: (id: string) => void;
  onViewRecord: () => void;
}) {
  if (configuration === undefined)
    return (
      <div className="col">
        <dl className={styles.fields}>
          <dt>{C.environment}</dt>
          <dd>{C.build[module.build]}</dd>
          <dt>{C.directory}</dt>
          <dd>
            <code>{module.directory}</code>
          </dd>
        </dl>
        <p className="hint">{C.noConfig}</p>
      </div>
    );
  const runtime = [
    configuration.javaVersion === undefined ? undefined : C.java(configuration.javaVersion),
    C.build[module.build],
    configuration.includeProvided === true ? C.provided : undefined,
  ].filter(Boolean);
  const observation = run === undefined ? undefined : readinessLine(run);
  return (
    <>
      <dl className={styles.fields}>
        <dt>{C.configuration}</dt>
        <dd className="row wrap">
          {module.configurations.length > 1 ? (
            <select
              className="input"
              aria-label={C.configurationSelect}
              value={configuration.id}
              onChange={(event) => onSelect(event.target.value)}
            >
              {module.configurations.map(({ id, name }) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <span>{configuration.name}</span>
          )}
          {isDefault && <span className={styles.tag}>{C.default}</span>}
        </dd>
        <dt>{C.entry}</dt>
        <dd>
          <code>{configuration.mainClass || C.noEntry}</code>
        </dd>
        <dt>{C.environment}</dt>
        <dd>{runtime.join(' / ')}</dd>
        <dt>{C.directory}</dt>
        <dd>
          <code>{configuration.directory}</code>
        </dd>
        <dt>{C.source}</dt>
        <dd className="row wrap">
          <code>{configuration.source}</code>
          {configuration.scope === 'local' && <span className={styles.tag}>{C.local}</span>}
        </dd>
        {configuration.review.length > 0 && (
          <>
            <dt>{C.needsReview}</dt>
            <dd>{configuration.review.join('、')}</dd>
          </>
        )}
      </dl>
      {run !== undefined && (
        <div className={styles.evidence}>
          <Icon name={verified ? 'check' : 'terminal'} size="sm" />
          <div className="grow">
            <strong>
              {verified ? C.checkPassed : run.status === 'failed' ? C.checkBlocked : C.status[run.status]}
            </strong>
            <p>
              {observation === undefined ? '' : `${observation} · `}
              {C.startedOn(formatDateTime(run.startedAt), C.status[run.status])}
            </p>
          </div>
          <button type="button" className={`btn ghost sm ${styles.recordLink}`} onClick={onViewRecord}>
            {C.viewRecord}
          </button>
        </div>
      )}
    </>
  );
}
