import { FUNCTIONAL_TEST_WORKFLOW_KEY, type ProjectModuleCompound, type ProjectModules } from '@aw/shared';
import * as Tabs from '@radix-ui/react-tabs';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { ROUTES } from '../../../app/routes.ts';
import { Button } from '../../../components/button.tsx';
import { ErrorState } from '../../../components/error-state.tsx';
import { PROJECT_MODULES_COPY as C } from '../../../copy/project-modules.ts';
import { ModuleRecords, ModuleState } from './module-records.tsx';
import styles from './project-modules.module.css';
import { activeModuleRun, type useProjectModules } from './project-modules.queries.ts';

export function ProjectCompoundDetail({
  compound,
  snapshot,
  operations,
}: {
  compound: ProjectModuleCompound;
  snapshot: ProjectModules;
  operations: ReturnType<typeof useProjectModules>;
}) {
  const [tab, setTab] = useState('members');
  const [selected, setSelected] = useState<string>();
  const targetId = useId();
  const plan = compound.plan;
  const services = plan?.services ?? [];
  const target = services.find(({ id }) => id === selected)?.id ?? plan?.targetServiceId;
  const serviceName = (id: string) => services.find((service) => service.id === id)?.name ?? id;
  const runs = snapshot.runs.filter(({ compoundId }) => compoundId === compound.id);
  const run = runs[0];
  const active = snapshot.runs.find(activeModuleRun);
  const { start, stop, rediscover } = operations;
  const busy = start.isPending || stop.isPending || rediscover.isPending;
  const available = plan !== null && compound.review.length === 0 && target !== undefined;
  return (
    <article className={styles.detail} aria-label={compound.name}>
      <header className={styles.detailHead}>
        <div className="row wrap">
          <h3>{compound.name}</h3>
          {run !== undefined && (
            <ModuleState
              state={
                run.fingerprint === compound.fingerprint && run.baseline === snapshot.baseline ? run.status : 'stale'
              }
            />
          )}
        </div>
        <p>
          {compound.source}
          {compound.scope === 'local' && ` · ${C.local}`}
        </p>
      </header>
      <Tabs.Root className={styles.detailTabs} value={tab} onValueChange={setTab}>
        <Tabs.List className={`tabs ${styles.tabs}`} aria-label={C.tabs}>
          <Tabs.Trigger className="tab" value="members">
            {C.compoundMembers}
          </Tabs.Trigger>
          <Tabs.Trigger className="tab" value="records">
            {C.records}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className={styles.content} value="members">
          <ul className={styles.checkList} aria-label={C.compoundMembers}>
            {compound.members.map((member, index) => {
              const module = snapshot.modules.find(({ id }) => id === member.moduleId);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: IDEA 可重复声明同名成员，按源文件顺序显示。
                <li key={`${index}:${member.name}`} className={styles.compoundMember}>
                  <div className="col">
                    <strong>{member.name}</strong>
                    <small>
                      {[module?.name, member.source, member.scope === 'local' ? C.local : undefined]
                        .filter(Boolean)
                        .join(' · ') || member.type}
                    </small>
                  </div>
                  <span className="hint">{C.memberStatus[member.status]}</span>
                </li>
              );
            })}
          </ul>
          <section className={styles.dependents} aria-label={C.dependencies}>
            <h4>{C.dependencies}</h4>
            {plan === null ? (
              <p className="hint">{C.unresolvedDependencies}</p>
            ) : (
              <ul>
                {services.map((service) => (
                  <li key={service.id}>
                    {serviceName(service.id)} · {service.dependsOn.map(serviceName).join('、') || C.independentServices}
                    {service.inject.length > 0 && (
                      <small className={styles.injections}>
                        {service.inject.map(({ env, serviceId }) => `${env} ← ${serviceName(serviceId)}`).join(' · ')}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {compound.review.length > 0 && (
            <ul>
              {compound.review.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Tabs.Content>
        <Tabs.Content className={styles.content} value="records">
          <ModuleRecords runs={runs} />
        </Tabs.Content>
        <footer className={styles.actions}>
          {available && (
            <label className="row wrap" htmlFor={targetId}>
              {C.targetService}
              <select
                id={targetId}
                className="input"
                value={target}
                onChange={(event) => setSelected(event.target.value)}
              >
                {services.map(({ id }) => (
                  <option value={id} key={id}>
                    {serviceName(id)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row wrap">
            {active?.compoundId === compound.id ? (
              <Button
                variant="primary"
                icon="stop"
                pending={stop.isPending}
                disabled={busy}
                onClick={() => stop.mutate(active.id)}
              >
                {C.stop}
              </Button>
            ) : (
              available && (
                <Button
                  variant="primary"
                  icon="play"
                  pending={start.isPending}
                  disabled={busy || active !== undefined}
                  onClick={() =>
                    start.mutate(
                      {
                        compoundId: compound.id,
                        targetServiceId: target,
                        fingerprint: compound.fingerprint,
                        baseline: snapshot.baseline,
                      },
                      { onSuccess: () => setTab('records') },
                    )
                  }
                >
                  {C.compoundTrial}
                </Button>
              )
            )}
            {available && (
              <Link
                className="btn secondary"
                to={ROUTES.home}
                search={{
                  projectId: snapshot.projectId,
                  workflow: FUNCTIONAL_TEST_WORKFLOW_KEY,
                  compoundId: compound.id,
                  compoundFingerprint: compound.fingerprint,
                  targetServiceId: target,
                }}
              >
                {C.test}
              </Link>
            )}
          </div>
          {start.isError && <ErrorState error={start.error} />}
          {stop.isError && <ErrorState error={stop.error} />}
        </footer>
      </Tabs.Root>
    </article>
  );
}
