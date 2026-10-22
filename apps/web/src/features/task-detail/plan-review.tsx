import { type PlanGraph, type RoleDTO, type TaskDetailDTO, transitiveDependencies, WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { CANVAS_COPY } from '../../copy/plan-editor.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { rolesQuery, useConfirmPlan, useReplan } from '../tasks/tasks.queries.ts';
import { stepsOfPlan } from './steps.ts';
import styles from './task-page.module.css';
import { TaskPlanEditor } from './task-plan-editor.tsx';

/** The plan's steps in an order that runs each after its dependencies: fewer transitive dependencies first. */
function PlanSteps({ graph, roles }: { graph: PlanGraph; roles: readonly RoleDTO[] }) {
  const depth = new Map(graph.nodes.map((n) => [n.key, transitiveDependencies(graph.nodes, n.key).size]));
  const ordered = graph.nodes.toSorted((a, b) => (depth.get(a.key) ?? 0) - (depth.get(b.key) ?? 0));
  return (
    <ol className={styles.planSteps} data-testid="plan-steps">
      {ordered.map((n) => (
        <li key={n.key}>
          <span className="row">
            <span className={`${styles.stepTitle} grow`}>{n.title}</span>
            <span className="chip">{roles.find((r) => r.key === n.roleKey)?.name ?? n.roleKey}</span>
          </span>
          <p className={styles.instructions}>{n.instructions}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Plan waiting for confirmation (14 §3.3): read-only canvas, summary, assumptions; confirm or send feedback. The pro
 * view can edit the plan first (M5-01), which saves a new draft version.
 */
export function PlanReview({ task, pro }: { task: TaskDetailDTO; pro: boolean }) {
  const roles = useQuery(rolesQuery);
  const confirm = useConfirmPlan();
  const replan = useReplan();
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const { plan } = task;
  if (plan === null) return null;
  if (editing) return <TaskPlanEditor task={task} base={plan} onDone={() => setEditing(false)} />;
  const sendFeedback = (e: FormEvent) => {
    e.preventDefault();
    replan.mutate({ id: task.id, feedback: feedback.trim() }, { onSuccess: () => setFeedback('') });
  };
  return (
    <div className={styles.layout}>
      <ProgressCanvas steps={stepsOfPlan(plan.graph, roles.data ?? [])} label={CANVAS_COPY.planLabel} />
      <aside className={styles.side}>
        <Panel title={`${C.planTitle} · ${C.planVersion(plan.version)}`}>
          <div className={styles.result}>
            {plan.summary !== null && <Markdown source={plan.summary} />}
            <section className={styles.block}>
              <h3 className="sec-t">{C.planSteps(plan.graph.nodes.length)}</h3>
              <PlanSteps graph={plan.graph} roles={roles.data ?? []} />
            </section>
            {plan.assumptions.length > 0 && (
              <section className={styles.block}>
                <h3 className="sec-t">{C.assumptions}</h3>
                <ul className={styles.bullets}>
                  {plan.assumptions.map((a) => (
                    <li key={a}>
                      <Markdown inline source={a} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <Button
              variant="primary"
              icon="check"
              pending={confirm.isPending}
              onClick={() =>
                confirm.mutate({ id: task.id, version: plan.version }, { onSuccess: () => toast(C.planConfirmed) })
              }
            >
              {C.confirmPlan}
            </Button>
            {pro && (
              <Button icon="edit" onClick={() => setEditing(true)}>
                {C.editPlan}
              </Button>
            )}
            {confirm.isError && <ErrorState error={confirm.error} />}
          </div>
        </Panel>
        {task.workflow.planning === WorkflowPlanning.Ai && (
          <Panel title={C.replan}>
            <form className="col" onSubmit={sendFeedback}>
              <textarea
                className="textarea"
                rows={3}
                aria-label={C.replan}
                placeholder={C.replanPlaceholder}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <div className="row">
                <Button type="submit" pending={replan.isPending} disabled={feedback.trim() === ''}>
                  {C.replanSend}
                </Button>
              </div>
              {replan.isError && <ErrorState error={replan.error} />}
            </form>
          </Panel>
        )}
      </aside>
    </div>
  );
}
