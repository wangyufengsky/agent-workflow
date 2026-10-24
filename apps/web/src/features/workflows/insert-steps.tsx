import { type PlanNodeSpec, WorkflowPlanning } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { WORKFLOW_EDITOR_COPY as C } from '../../copy/workflows.ts';
import { workflowQuery, workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './workflows.module.css';

/**
 * 插入流程的步骤 (34 §15.7, D150): pick another fixed workflow, see its steps, and copy them into this one. Workflows
 * planned by the AI have no steps until a task runs, so only fixed ones are offered.
 */
export function InsertSteps({
  workflowKey,
  onInsert,
}: {
  /** The workflow being edited, left out of the choices. */
  workflowKey: string;
  onInsert: (steps: readonly PlanNodeSpec[], name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const list = useQuery({ ...workflowsQuery, enabled: open });
  const sources = (list.data ?? []).filter((w) => w.planning === WorkflowPlanning.Fixed && w.key !== workflowKey);
  const source = useQuery({ ...workflowQuery(picked ?? ''), enabled: picked !== undefined });
  const steps = source.data?.definition.template?.nodes ?? [];
  const close = () => {
    setOpen(false);
    setPicked(undefined);
  };
  return (
    <>
      <Button size="sm" icon="flow" onClick={() => setOpen(true)}>
        {C.insertSteps}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={C.insertTitle}
        description={C.insertBody}
        footer={
          <>
            <Button onClick={close}>{COMMON_COPY.cancel}</Button>
            <Button
              variant="primary"
              disabled={steps.length === 0}
              pending={source.isFetching}
              onClick={() => {
                onInsert(steps, source.data?.name ?? '');
                close();
              }}
            >
              {C.insert}
            </Button>
          </>
        }
      >
        {list.data !== undefined && sources.length === 0 && <p className="hint">{C.insertNone}</p>}
        <fieldset className={styles.sources}>
          {sources.map((w) => (
            <label key={w.id} className={styles.source}>
              <input type="radio" name="insert-source" checked={picked === w.id} onChange={() => setPicked(w.id)} />
              <b>{w.name}</b>
              <small>
                {picked === w.id && steps.length > 0 ? steps.map((s) => s.title).join(' → ') : w.description}
              </small>
            </label>
          ))}
        </fieldset>
        {(list.error ?? source.error) !== null && <ErrorState error={list.error ?? source.error} />}
      </Dialog>
    </>
  );
}
