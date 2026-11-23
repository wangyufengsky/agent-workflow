import type { FunctionalTestLaunchDiagnostics, FunctionalTestServiceRuntime } from '@aw/shared';
import { useId, useState } from 'react';
import { PROJECT_MODULES_COPY as C } from '../../../copy/project-modules.ts';
import styles from './project-modules.module.css';

export function ServiceRuntimeEvidence({
  services,
  initialServiceId,
}: {
  services: readonly FunctionalTestServiceRuntime[];
  initialServiceId: string | undefined;
}) {
  const [selected, setSelected] = useState(initialServiceId);
  const selectId = useId();
  const service = services.find(({ id }) => id === selected) ?? services[0];
  if (service === undefined) return null;
  const diagnostic = service.diagnostics;
  return (
    <section className={styles.serviceRuntime} aria-label={C.serviceDiagnostics}>
      <div className="row wrap">
        <label htmlFor={selectId}>{C.serviceDiagnostics}</label>
        <select
          id={selectId}
          className="input"
          value={service.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {services.map(({ id, name, moduleId }) => (
            <option key={id} value={id}>
              {name ?? moduleId ?? id}
            </option>
          ))}
        </select>
      </div>
      <dl className={styles.serviceFacts}>
        <dt>{C.serviceAddress}</dt>
        <dd>
          <code>{service.target ?? C.noEntry}</code>
        </dd>
        {service.readyUrl != null && (
          <>
            <dt>{C.serviceProbe}</dt>
            <dd>
              <code>
                {service.readyUrl}
                {service.readyStatus != null ? ` · HTTP ${service.readyStatus}` : ''}
              </code>
            </dd>
          </>
        )}
      </dl>
      {diagnostic !== undefined && <LaunchDiagnostics diagnostics={diagnostic} />}
      <pre className={`mono ${styles.log}`}>{service.logTail || C.noLogs}</pre>
    </section>
  );
}

export function LaunchDiagnostics({ diagnostics }: { diagnostics: FunctionalTestLaunchDiagnostics }) {
  const { requested, workingDirectory, manager, javaVersion, classpathEntries, includeProvided } = diagnostics;
  const java = (value: number | undefined, missing: string) => (value === undefined ? missing : C.java(value));
  const dependencies = (value: boolean | undefined, missing: string) =>
    value === undefined ? missing : value ? C.provided : C.runtimeDependencies;
  return (
    <div className={styles.diagnosticsGrid}>
      {requested !== undefined && (
        <section className="col" aria-label={C.requestedLaunch}>
          <h4>{C.requestedLaunch}</h4>
          <dl className={styles.serviceFacts}>
            <dt>{C.directory}</dt>
            <dd>
              <code>{requested.workingDirectory}</code>
            </dd>
            <dt>{C.javaVersion}</dt>
            <dd>{java(requested.javaVersion, C.notSpecified)}</dd>
            <dt>{C.dependencyScope}</dt>
            <dd>{dependencies(requested.includeProvided, C.notSpecified)}</dd>
          </dl>
        </section>
      )}
      <section className="col" aria-label={C.resolvedLaunch}>
        <h4>{C.resolvedLaunch}</h4>
        <dl className={styles.serviceFacts}>
          <dt>{C.directory}</dt>
          <dd>
            <code>{workingDirectory}</code>
          </dd>
          <dt>{C.environment}</dt>
          <dd>{manager}</dd>
          <dt>{C.javaVersion}</dt>
          <dd>{java(javaVersion, C.notRecorded)}</dd>
          <dt>{C.classpath}</dt>
          <dd>{classpathEntries ?? C.notRecorded}</dd>
          <dt>{C.dependencyScope}</dt>
          <dd>{dependencies(includeProvided, C.notRecorded)}</dd>
          <DiagnosticFact label={C.managedVmOptions} values={diagnostics.managedVmOptions} />
          <DiagnosticFact
            label={C.beforeRun}
            values={diagnostics.beforeRun.map((step) => C.beforeRunSteps[step] ?? step)}
          />
          <DiagnosticFact label={C.injectedEnvironment} values={diagnostics.injectedEnvironment} />
        </dl>
      </section>
    </div>
  );
}

function DiagnosticFact({ label, values }: { label: string; values: string[] }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {values.length === 0
          ? C.notRecorded
          : [...new Set(values)].map((value) => (
              <div key={value}>
                <code>{value}</code>
              </div>
            ))}
      </dd>
    </>
  );
}
