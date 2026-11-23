import { type FunctionalTestEvent, FunctionalTestStatus } from '@aw/shared';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import styles from './functional-test.module.css';

export function failureServices(events: readonly FunctionalTestEvent[]) {
  const byService = new Map<string, { service: string; module: string | undefined; log: string | undefined }>();
  for (const event of events) {
    const { serviceId, serviceName, moduleId, serviceLog } = event.detail;
    if (typeof serviceId !== 'string') continue;
    const { passed, status } = event.detail;
    const failed =
      (event.kind === 'assertion' && (passed === false || passed === null)) ||
      ((event.kind === 'result' || event.kind === 'cleanup') &&
        (status === FunctionalTestStatus.Failed || status === FunctionalTestStatus.Blocked));
    if (!failed) continue;
    const before = byService.get(serviceId);
    byService.set(serviceId, {
      service: typeof serviceName === 'string' ? serviceName : (before?.service ?? serviceId),
      module: typeof moduleId === 'string' ? moduleId : before?.module,
      log: typeof serviceLog === 'string' && serviceLog !== '' ? serviceLog : before?.log,
    });
  }
  return byService;
}

export function FailureServiceEvidence({ events }: { events: readonly FunctionalTestEvent[] }) {
  const services = failureServices(events);
  if (services.size === 0) return null;
  return (
    <section className="col" aria-label={C.failureService}>
      <h4>{C.failureService}</h4>
      <ul className={styles.items}>
        {[...services].map(([id, { service, module, log }]) => (
          <li key={id} className="col">
            <strong>{service}</strong>
            {module !== undefined && (
              <small>
                {C.failureModule} · <code>{module}</code>
              </small>
            )}
            {log !== undefined && (
              <details className={styles.inspector}>
                <summary>{C.failureServiceLog}</summary>
                <pre className={styles.output}>{log}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
