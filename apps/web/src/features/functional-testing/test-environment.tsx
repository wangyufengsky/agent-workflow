import type { FunctionalTestRun } from '@aw/shared';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { LaunchDiagnostics, ServiceRuntimeEvidence } from '../projects/modules/service-runtime-evidence.tsx';
import styles from './functional-test.module.css';

type Environment = FunctionalTestRun['environment'];

function EnvironmentChecks({ checks }: { checks: Environment['checks'] }) {
  return (
    <section className={styles.assertions} aria-label={C.environmentChecks}>
      <h3>{C.environmentChecks}</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">{C.assertionField}</th>
            <th scope="col">{C.expected}</th>
            <th scope="col">{C.actual}</th>
          </tr>
        </thead>
        <tbody>
          {checks.map(({ key, path, expectedStatus, status, ready, reason }) => (
            <tr key={key} data-result={!ready ? 'failed' : undefined}>
              <th scope="row">
                <span>{key}</span>
                <br />
                <code>{path}</code>
              </th>
              <td>
                <code>{expectedStatus}</code>
              </td>
              <td>
                <code>{status ?? C.noValue}</code>
                {reason !== null && <p>{reason}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TestEnvironment({ environment }: { environment: Environment | undefined }) {
  const launch = environment?.launch;
  return (
    <section className={styles.panel} aria-label={C.prepare}>
      <header className={styles.panelHead}>
        <h2>{C.prepare}</h2>
        {environment !== undefined && (
          <span className={styles.statusBadge} data-status={environment.ready ? 'passed' : 'blocked'}>
            {environment.ready ? C.environmentReady : C.status.blocked}
          </span>
        )}
      </header>
      <div className={styles.evidenceBody}>
        {environment === undefined ? (
          <p className="hint">{C.noEnvironment}</p>
        ) : (
          <>
            <dl className={styles.environment}>
              <dt>{C.environmentTarget}</dt>
              <dd>
                <code>{environment.target}</code>
              </dd>
              <dt>{C.baseline}</dt>
              <dd>
                <code>{environment.baseline ?? C.baselineUnverified}</code>
                {!environment.verified && environment.baseline !== null && <span> · {C.baselineUnverified}</span>}
              </dd>
              {launch !== undefined && (
                <>
                  <dt>{C.launchSource}</dt>
                  <dd>{launch.source}</dd>
                  <dt>{C.launchScript}</dt>
                  <dd>
                    <code>{launch.script}</code>
                  </dd>
                  {launch.mainClass !== undefined && (
                    <>
                      <dt>{C.launchMainClass}</dt>
                      <dd>
                        <code>{launch.mainClass}</code>
                      </dd>
                    </>
                  )}
                  {launch.javaVersion !== undefined && (
                    <>
                      <dt>{C.launchJavaVersion}</dt>
                      <dd>
                        <code>Java {launch.javaVersion}</code>
                      </dd>
                    </>
                  )}
                  {launch.includeProvided !== undefined && (
                    <>
                      <dt>{C.launchProvided}</dt>
                      <dd>{launch.includeProvided ? C.launchIncludesProvided : C.launchExcludesProvided}</dd>
                    </>
                  )}
                  <dt>{C.launchDirectory}</dt>
                  <dd>
                    <code>{launch.directory}</code>
                  </dd>
                  {launch.profile !== undefined && (
                    <>
                      <dt>{C.launchProfile}</dt>
                      <dd>
                        <code>{launch.profile}</code>
                      </dd>
                    </>
                  )}
                </>
              )}
              {environment.command !== undefined && (
                <>
                  <dt>{C.launchCommand}</dt>
                  <dd>
                    <code>{environment.command}</code>
                  </dd>
                </>
              )}
              {environment.readyUrl !== undefined ? (
                <>
                  <dt>{C.environmentReadyUrl}</dt>
                  <dd>
                    <code>{environment.readyUrl}</code>
                  </dd>
                </>
              ) : (
                launch !== undefined && (
                  <>
                    <dt>{C.environmentReadyPath}</dt>
                    <dd>
                      <code>{launch.readyPath}</code>
                    </dd>
                  </>
                )
              )}
              {environment.readyStatus !== undefined && (
                <>
                  <dt>{C.environmentProbeStatus}</dt>
                  <dd>
                    <code>HTTP {environment.readyStatus}</code>
                  </dd>
                </>
              )}
            </dl>
            {environment.reason !== null && <p className={styles.caution}>{environment.reason}</p>}
            {environment.diagnostics !== undefined && <LaunchDiagnostics diagnostics={environment.diagnostics} />}
            {environment.checks.length > 0 && <EnvironmentChecks checks={environment.checks} />}
            {environment.services?.length ? (
              <ServiceRuntimeEvidence services={environment.services} initialServiceId={environment.targetServiceId} />
            ) : (
              environment.logTail !== '' && <pre className={styles.output}>{environment.logTail}</pre>
            )}
          </>
        )}
      </div>
    </section>
  );
}
