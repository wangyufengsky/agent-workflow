import type { ProjectJavaModule } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../../../components/button.tsx';
import { ErrorState } from '../../../components/error-state.tsx';
import { Icon, type IconName } from '../../../components/icon.tsx';
import { COMMON_COPY, formatDateTime } from '../../../copy/common.ts';
import { PROJECT_MODULES_COPY as C } from '../../../copy/project-modules.ts';
import { stateTone } from './module-records.tsx';
import { ProjectCompoundDetail } from './project-compound-detail.tsx';
import { moduleState, ProjectModuleDetail, preferredConfiguration } from './project-module-detail.tsx';
import styles from './project-modules.module.css';
import { useProjectModules } from './project-modules.queries.ts';

const kindIcon: Record<ProjectJavaModule['kind'], IconName> = {
  service: 'server',
  batch: 'terminal',
  library: 'layers',
  unknown: 'folder',
};

export function ProjectModulesPanel({ projectId, branch }: { projectId: string; branch: string }) {
  const operations = useProjectModules(projectId, branch);
  const { query, rediscover, start, stop, setDefault } = operations;
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string>();
  const [selectedCompound, setSelectedCompound] = useState<string>();
  const [checksModule, setChecksModule] = useState<string>();
  const [chosenConfigs, setChosenConfigs] = useState<Record<string, string>>({});
  const snapshot = query.data;
  const modules = snapshot?.modules ?? [];
  const compounds = snapshot?.compounds ?? [];
  const term = filter.trim().toLocaleLowerCase();
  const shown = modules.filter((module) =>
    [module.name, module.directory, C.kind[module.kind]].some((value) => value.toLocaleLowerCase().includes(term)),
  );
  const shownCompounds = compounds.filter(({ name, source }) =>
    [name, source, C.compound].some((value) => value.toLocaleLowerCase().includes(term)),
  );
  const compound =
    shownCompounds.find(({ id }) => id === selectedCompound) ?? (shown.length === 0 ? shownCompounds[0] : undefined);
  const module = shown.find(({ id }) => id === selected) ?? shown[0];
  const serviceCount = modules.filter(({ kind }) => kind === 'service').length;
  const busy = start.isPending || stop.isPending || setDefault.isPending;
  const discover = () => {
    // 默认失效时仍保留用户正在看的配置，以便展示旧记录与待验证状态。
    if (snapshot !== undefined && module !== undefined && chosenConfigs[module.id] === undefined) {
      const configuration = preferredConfiguration(snapshot, module);
      if (configuration !== undefined) {
        setChosenConfigs((previous) => ({ ...previous, [module.id]: configuration.id }));
      }
    }
    rediscover.mutate();
  };
  return (
    <section className={styles.panel} aria-label={C.title}>
      <header className={styles.heading}>
        <div>
          <h2>{C.title}</h2>
          {snapshot !== undefined && <p>{C.summary(modules.length, serviceCount)}</p>}
        </div>
        <Button icon="refresh" pending={rediscover.isPending} disabled={busy || query.isPending} onClick={discover}>
          {C.discovery}
        </Button>
      </header>
      {(query.isPending || query.isError || rediscover.isError) && (
        <div className={styles.empty}>
          {query.isPending && <p>{COMMON_COPY.loading}</p>}
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          {rediscover.isError && <ErrorState error={rediscover.error} />}
        </div>
      )}
      {snapshot !== undefined && (
        <>
          {modules.length === 0 && compounds.length === 0 ? (
            <p className={styles.empty}>{C.noModules}</p>
          ) : (
            <div className={styles.layout}>
              <aside className={styles.rail} aria-label={C.list}>
                <label className={styles.search}>
                  <Icon name="search" size="sm" />
                  <input
                    type="search"
                    className="input"
                    placeholder={C.searchPlaceholder}
                    aria-label={C.search}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </label>
                <div className={styles.moduleList}>
                  {shown.map((item) => {
                    const config = item.configurations.find(({ id }) => id === chosenConfigs[item.id]);
                    const state = moduleState(snapshot, item, config ?? preferredConfiguration(snapshot, item));
                    return (
                      <button
                        type="button"
                        className={styles.module}
                        key={item.id}
                        aria-pressed={compound === undefined && item.id === module?.id}
                        onClick={() => {
                          setSelected(item.id);
                          setSelectedCompound(undefined);
                          setChecksModule(undefined);
                        }}
                      >
                        <span className={styles.moduleIcon}>
                          <Icon name={kindIcon[item.kind]} size="sm" />
                        </span>
                        <span className={styles.moduleText}>
                          <strong className="mono ellipsis">{item.name}</strong>
                          <small>{C.kind[item.kind]}</small>
                        </span>
                        <span
                          className={styles.kindDot}
                          data-tone={stateTone(state)}
                          title={C.status[state]}
                          aria-hidden="true"
                        />
                        <span className={styles.sr}>{C.status[state]}</span>
                      </button>
                    );
                  })}
                  {shownCompounds.map((item) => (
                    <button
                      type="button"
                      className={styles.module}
                      key={item.id}
                      aria-pressed={compound?.id === item.id}
                      onClick={() => setSelectedCompound(item.id)}
                    >
                      <span className={styles.moduleIcon}>
                        <Icon name="layers" size="sm" />
                      </span>
                      <span className={styles.moduleText}>
                        <strong className="mono ellipsis">{item.name}</strong>
                        <small>{C.compound}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
              {compound !== undefined ? (
                <ProjectCompoundDetail
                  key={compound.id}
                  compound={compound}
                  snapshot={snapshot}
                  operations={operations}
                />
              ) : module === undefined ? (
                <p className={styles.empty}>{C.noSearch}</p>
              ) : (
                <ProjectModuleDetail
                  key={module.id}
                  snapshot={snapshot}
                  module={module}
                  operations={operations}
                  selectedConfig={chosenConfigs[module.id]}
                  onSelectConfig={(id) => setChosenConfigs((previous) => ({ ...previous, [module.id]: id }))}
                  openChecks={checksModule === module.id}
                  onChooseDependent={(id) => {
                    setFilter('');
                    setSelected(id);
                    setChecksModule(id);
                  }}
                />
              )}
            </div>
          )}
          <footer className={styles.footer}>
            {snapshot.scannedAt > 0 && (
              <span>
                {C.recentDiscovery} · {formatDateTime(snapshot.scannedAt)}
              </span>
            )}
            {snapshot.warnings.length > 0 && (
              <details>
                <summary>{C.discoveryWarnings}</summary>
                <ul>
                  {snapshot.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
