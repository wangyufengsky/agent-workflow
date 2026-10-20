import type { TaskDetailDTO } from '@aw/shared';
import { WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { rolesQuery, useConfirmPlan, useReplan } from '../tasks/tasks.queries.ts';
import { stepsOfPlan } from './steps.ts';
import styles from './task-page.module.css';

/** Plan waiting for confirmation (14 §3.3): read-only canvas, summary, assumptions; confirm or send feedback. */
export function PlanReview({ task }: { task: TaskDetailDTO }) {
  const roles = useQuery(rolesQuery);
  const confirm = useConfirmPlan();
  const replan = useReplan();
  const [feedback, setFeedback] = useState('');
  const { plan } = task;
  if (plan === null) return null;
  const sendFeedback = (e: FormEvent) => {
    e.preventDefault();
    replan.mutate({ id: task.id, feedback: feedback.trim() }, { onSuccess: () => setFeedback('') });
  };
  return (
    <div className={styles.layout}>
      <ProgressCanvas steps={stepsOfPlan(plan, roles.data ?? [])} />
      <aside className={styles.side}>
        <Panel title={`${C.planTitle} · ${C.planVersion(plan.version)}`}>
          <div className="col">
            {plan.summary !== null && <Markdown source={plan.summary} />}
            {plan.assumptions.length > 0 && (
              <>
                <h3 className="sec-t">{C.assumptions}</h3>
                <ul>
                  {plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
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
