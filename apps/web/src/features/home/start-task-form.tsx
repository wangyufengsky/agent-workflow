import type { ProjectDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { useCreateTask, workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './start-task.module.css';
import { workflowIcon } from './workflow-icon.ts';

/** One step to start a task (14 §3.2): project, workflow card, requirement, optional plan confirmation. */
export function StartTaskForm({
  projects,
  projectId,
  onProjectChange,
}: {
  projects: readonly ProjectDTO[];
  projectId: string;
  onProjectChange: (id: string) => void;
}) {
  const workflows = useQuery(workflowsQuery);
  const [workflowId, setWorkflowId] = useState<string | undefined>(undefined);
  const [requirement, setRequirement] = useState('');
  const [confirmPlan, setConfirmPlan] = useState(false);
  const create = useCreateTask();
  const navigate = useNavigate();
  const selected = workflowId ?? workflows.data?.[0]?.id;
  const canStart = selected !== undefined && projectId !== '' && requirement.trim() !== '';

  const start = () => {
    if (!canStart) return;
    create.mutate(
      {
        projectId,
        workflowId: selected,
        requirement: requirement.trim(),
        ...(confirmPlan ? { checkpoints: { confirm_plan: true } } : {}),
      },
      { onSuccess: (task) => void navigate({ to: ROUTES.task, params: { taskId: task.id } }) },
    );
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      start();
    }
  };

  return (
    <form className="card pad col" onSubmit={submit} aria-label={C.start}>
      {projects.length > 1 && (
        <div className="field">
          <label className="label" htmlFor="start-project">
            {C.project}
          </label>
          <select
            id="start-project"
            className="select"
            value={projectId}
            onChange={(e) => onProjectChange(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <span className="label" id="start-workflow">
          {C.workflow}
        </span>
        {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
        <fieldset className={styles.workflows} aria-labelledby="start-workflow">
          {workflows.data?.map((w) => (
            <button
              key={w.id}
              type="button"
              className={styles.workflow}
              aria-pressed={w.id === selected}
              onClick={() => setWorkflowId(w.id)}
            >
              <Icon name={workflowIcon(w.key)} />
              <span className={styles.name}>{w.name}</span>
              <span className={styles.description}>{w.description}</span>
            </button>
          ))}
        </fieldset>
      </div>
      <div className="field">
        <label className="label" htmlFor="start-requirement">
          {C.requirement}
        </label>
        <textarea
          id="start-requirement"
          className="textarea"
          rows={5}
          placeholder={C.requirementPlaceholder}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {create.isError && <ErrorState error={create.error} />}
      <div className={styles.footer}>
        <label className="check grow">
          <input type="checkbox" checked={confirmPlan} onChange={(e) => setConfirmPlan(e.target.checked)} />
          <span>{C.confirmPlan}</span>
        </label>
        <Button type="submit" variant="primary" icon="sparkle" pending={create.isPending} disabled={!canStart}>
          {C.start}
          <span className="kbd">{C.startShortcut}</span>
        </Button>
      </div>
    </form>
  );
}
