import { type NodeStatus, type PlanGraph, planEditRules, type TaskDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { EditTools } from '../../canvas/edit-tools.tsx';
import { checkPlan, type PlanLock } from '../../canvas/plan-check.ts';
import { PlanEditor } from '../../canvas/plan-editor.tsx';
import { ProblemCount } from '../../canvas/problem-count.tsx';
import { useHistory } from '../../canvas/use-history.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { CANVAS_COPY } from '../../copy/plan-editor.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { rolesQuery, useSaveDraftPlan, workflowQuery } from '../tasks/tasks.queries.ts';

type Props = {
  task: TaskDetailDTO;
  /** The plan version the edit starts from: the task's latest (11 §6 `baseVersion`). */
  base: { version: number; graph: PlanGraph };
  lock?: PlanLock | undefined;
  statuses?: ReadonlyMap<string, NodeStatus> | undefined;
  /** Saved or abandoned: back to the read-only view. */
  onDone: () => void;
};

/** Editing a task's plan (M5-01 / M5-02): the plan editor with the workflow's rules, saved as a new draft version. */
export function TaskPlanEditor({ task, base, lock, statuses, onDone }: Props) {
  const roles = useQuery(rolesQuery);
  const workflow = useQuery(workflowQuery(task.workflow.id));
  const save = useSaveDraftPlan();
  const history = useHistory(base.graph);
  const graph = history.value;
  if (workflow.isError) return <ErrorState error={workflow.error} onRetry={() => void workflow.refetch()} />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />;
  if (workflow.data === undefined || roles.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
  const rules = planEditRules(workflow.data.definition, base.graph);
  const problems = checkPlan(graph, rules, lock);
  return (
    <PlanEditor
      label={CANVAS_COPY.planLabel}
      history={history}
      toolbar={(addStep) => (
        <>
          <EditTools history={history} addStep={addStep} />
          <ProblemCount count={problems.length} />
        </>
      )}
      rules={rules}
      roles={roles.data}
      lock={lock}
      statuses={statuses}
      problems={problems}
      actions={
        <>
          {save.isError && <ErrorState error={save.error} />}
          <div className="row">
            <Button
              variant="primary"
              icon="check"
              pending={save.isPending}
              disabled={problems.length > 0}
              onClick={() =>
                save.mutate(
                  { id: task.id, baseVersion: base.version, graph },
                  {
                    onSuccess: (plan) => {
                      toast(C.planSaved(plan.version));
                      onDone();
                    },
                  },
                )
              }
            >
              {C.saveEdits}
            </Button>
            <Button variant="ghost" onClick={onDone}>
              {C.cancelEdits}
            </Button>
          </div>
        </>
      }
    />
  );
}
