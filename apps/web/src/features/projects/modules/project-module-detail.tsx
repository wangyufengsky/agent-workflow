import {
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  PROJECT_MODULE_CHECK_LIMIT,
  type ProjectJavaModule,
  type ProjectModuleCheck,
  type ProjectModuleConfiguration,
  type ProjectModules,
  projectModuleVerified,
} from '@aw/shared';
import * as Tabs from '@radix-ui/react-tabs';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../../app/routes.ts';
import { Button } from '../../../components/button.tsx';
import { ErrorState } from '../../../components/error-state.tsx';
import { PROJECT_MODULES_COPY as C } from '../../../copy/project-modules.ts';
import { ModuleConfiguration } from './module-configuration.tsx';
import { ModuleRecords, ModuleState } from './module-records.tsx';
import styles from './project-modules.module.css';
import { activeModuleRun, type useProjectModules } from './project-modules.queries.ts';

type Tab = 'configuration' | 'checks' | 'records';

export function moduleState(
  snapshot: ProjectModules,
  module: ProjectJavaModule,
  configuration?: ProjectModuleConfiguration,
) {
  if (configuration === undefined || configuration.launch === null) return 'no_entry';
  const run = snapshot.runs
    .filter(
      ({ kind, configurationId, moduleId }) =>
        kind === 'launch' && moduleId === module.id && configurationId === configuration.id,
    )
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (run === undefined) return 'discovered';
  if (run.baseline !== snapshot.baseline || run.fingerprint !== configuration.fingerprint) return 'stale';
  if (projectModuleVerified(run, configuration)) return 'verified';
  return run.status;
}

export const preferredConfiguration = (snapshot: ProjectModules, module: ProjectJavaModule) =>
  module.configurations.find(({ id }) => id === snapshot.defaults[module.id]) ?? module.configurations[0];

const isSuiteCheck = ({ kind }: ProjectModuleCheck) => kind === 'maven-test' || kind === 'gradle-test';

export function ProjectModuleDetail({
  snapshot,
  module,
  operations,
  selectedConfig,
  onSelectConfig,
  openChecks,
  onChooseDependent,
}: {
  snapshot: ProjectModules;
  module: ProjectJavaModule;
  operations: ReturnType<typeof useProjectModules>;
  selectedConfig: string | undefined;
  onSelectConfig(id: string): void;
  openChecks: boolean;
  onChooseDependent(id: string): void;
}) {
  const [tab, setTab] = useState<Tab>(openChecks ? 'checks' : 'configuration');
  const [selectedChecks, setSelectedChecks] = useState<string[]>();
  const configuration =
    module.configurations.find(({ id }) => id === selectedConfig) ?? preferredConfiguration(snapshot, module);
  const isDefault = configuration !== undefined && snapshot.defaults[module.id] === configuration.id;
  const runs = snapshot.runs
    .filter(
      ({ moduleId, configurationId, kind }) =>
        moduleId === module.id &&
        (kind === 'checks' || (configuration !== undefined && configurationId === configuration.id)),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const currentRun = runs.find(({ kind }) => kind === 'launch');
  const activeRun = snapshot.runs.find(activeModuleRun);
  const selectedRun =
    activeRun !== undefined &&
    activeRun.moduleId === module.id &&
    (activeRun.kind === 'checks' || activeRun.configurationId === configuration?.id)
      ? activeRun
      : undefined;
  const canLaunch = module.kind === 'service' && configuration?.launch != null;
  const current = moduleState(snapshot, module, configuration);
  const { start, stop, setDefault, rediscover } = operations;
  const busy = start.isPending || stop.isPending || setDefault.isPending || rediscover.isPending;
  const dependents = snapshot.modules.filter(({ id }) => module.dependentModules?.includes(id));
  const suite = module.checks.find(isSuiteCheck);
  const checked = module.checks
    .filter(({ id }) => selectedChecks?.includes(id) ?? id === suite?.id)
    .map(({ id }) => id);

  function toggleCheck(check: ProjectModuleCheck, on: boolean) {
    if (!on) setSelectedChecks(checked.filter((id) => id !== check.id));
    else if (isSuiteCheck(check)) setSelectedChecks([check.id]);
    else {
      const individual = checked.filter((id) => id !== suite?.id);
      if (individual.length < PROJECT_MODULE_CHECK_LIMIT) setSelectedChecks([...individual, check.id]);
    }
  }

  const atCheckLimit = checked.length >= PROJECT_MODULE_CHECK_LIMIT;
  const canSetDefault = canLaunch && configuration !== undefined && current === 'verified' && !isDefault;

  function trial() {
    if (configuration === undefined) return;
    const { id, fingerprint } = configuration;
    start.mutate(
      { moduleId: module.id, configurationId: id, baseline: snapshot.baseline, fingerprint },
      { onSuccess: () => setTab('records') },
    );
  }

  return (
    <article className={styles.detail} aria-label={module.name}>
      <header className={styles.detailHead}>
        <div className="row wrap">
          <h3>{module.name}</h3>
          <ModuleState state={current} />
        </div>
        <p>
          {C.kind[module.kind]} / {C.configurationCount(module.configurations.length)}
        </p>
      </header>
      <Tabs.Root
        className={styles.detailTabs}
        value={tab}
        onValueChange={(value) => {
          if (value === 'configuration' || value === 'checks' || value === 'records') setTab(value);
        }}
      >
        <Tabs.List className={`tabs ${styles.tabs}`} aria-label={C.tabs}>
          <Tabs.Trigger className="tab" value="configuration">
            {C.overview}
          </Tabs.Trigger>
          <Tabs.Trigger className="tab" value="checks">
            {C.checks} <span className={styles.count}>{module.checks.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger className="tab" value="records">
            {C.records}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className={styles.content} value="configuration">
          <ModuleConfiguration
            module={module}
            configuration={configuration}
            run={currentRun}
            isDefault={isDefault}
            verified={current === 'verified'}
            onSelect={onSelectConfig}
            onViewRecord={() => setTab('records')}
          />
        </Tabs.Content>
        <Tabs.Content className={styles.content} value="checks">
          {module.checks.length === 0 ? (
            <p className="hint">{C.noChecks}</p>
          ) : (
            <ul className={styles.checkList}>
              {module.checks.map((check) => {
                const run = runs.find(
                  ({ kind, checkIds, baseline }) =>
                    kind === 'checks' && baseline === snapshot.baseline && checkIds.includes(check.id),
                );
                return (
                  <li key={check.id}>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={checked.includes(check.id)}
                        disabled={atCheckLimit && !isSuiteCheck(check) && !checked.includes(check.id)}
                        onChange={(event) => toggleCheck(check, event.currentTarget.checked)}
                      />
                      <span>
                        {check.name}
                        <small>
                          {C.checkKind[check.kind]} · {check.source}
                        </small>
                      </span>
                      {run !== undefined && <ModuleState state={run.status} />}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {dependents.length > 0 && (
            <section className={styles.dependents} aria-label={C.dependentModules}>
              <h4>{C.dependentModules}</h4>
              <p className="hint">{C.dependentModulesHint}</p>
              <div className="row wrap">
                {dependents.map(({ id, name }) => (
                  <Button
                    key={id}
                    size="sm"
                    icon="chevRight"
                    aria-label={C.viewModuleChecks(name)}
                    onClick={() => onChooseDependent(id)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {atCheckLimit && <p className="hint">{C.checkLimit(PROJECT_MODULE_CHECK_LIMIT)}</p>}
          <p className="hint">{C.projectChecks}</p>
        </Tabs.Content>
        <Tabs.Content className={styles.content} value="records">
          <ModuleRecords runs={runs} />
        </Tabs.Content>
        <footer className={styles.actions}>
          <div className="row wrap">
            {selectedRun !== undefined ? (
              <Button
                variant="primary"
                icon="stop"
                pending={stop.isPending}
                disabled={busy}
                onClick={() => stop.mutate(selectedRun.id)}
              >
                {selectedRun.kind === 'checks' ? C.stopChecks : C.stop}
              </Button>
            ) : tab === 'checks' ? (
              <Button
                variant="primary"
                icon="play"
                pending={start.isPending}
                disabled={activeRun !== undefined || busy || checked.length === 0}
                onClick={() => start.mutate({ moduleId: module.id, baseline: snapshot.baseline, checkIds: checked })}
              >
                {C.executeChecks}
              </Button>
            ) : canLaunch ? (
              <Button
                variant="primary"
                icon="play"
                pending={start.isPending}
                disabled={activeRun !== undefined || busy}
                onClick={trial}
              >
                {C.trial}
              </Button>
            ) : (
              <Button icon="list" onClick={() => setTab('checks')}>
                {C.viewChecks}
              </Button>
            )}
            {canLaunch && configuration !== undefined && (
              <Link
                className="btn secondary"
                to={ROUTES.home}
                search={{
                  projectId: snapshot.projectId,
                  workflow: FUNCTIONAL_TEST_WORKFLOW_KEY,
                  moduleId: module.id,
                  configurationId: configuration.id,
                  configurationFingerprint: configuration.fingerprint,
                }}
              >
                {C.test}
              </Link>
            )}
          </div>
          {canSetDefault && configuration !== undefined && (
            <Button
              variant="ghost"
              pending={setDefault.isPending}
              disabled={busy}
              onClick={() =>
                setDefault.mutate({
                  moduleId: module.id,
                  configurationId: configuration.id,
                  fingerprint: configuration.fingerprint,
                })
              }
            >
              {C.setDefault}
            </Button>
          )}
        </footer>
      </Tabs.Root>
      {start.isError && <ErrorState error={start.error} />}
      {stop.isError && <ErrorState error={stop.error} />}
      {setDefault.isError && <ErrorState error={setDefault.error} />}
    </article>
  );
}
