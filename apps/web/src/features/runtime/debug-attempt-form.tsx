import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { DEBUG_COPY as C } from '../../copy/attempts.ts';
import { useStartDebugAttempt } from '../attempts/attempt.queries.ts';

/** Development builds only (M2-09): one execute attempt on a directory, without a task. */
export function DebugAttemptForm({ onStarted }: { onStarted: (attemptId: string) => void }) {
  const [directory, setDirectory] = useState('');
  const [requirement, setRequirement] = useState('');
  const [model, setModel] = useState('');
  const start = useStartDebugAttempt();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const chosen = model.trim();
    start.mutate(
      { directory: directory.trim(), requirement: requirement.trim(), ...(chosen === '' ? {} : { model: chosen }) },
      { onSuccess: (attempt) => onStarted(attempt.id) },
    );
  };

  return (
    <Panel title={C.title}>
      <p className="hint">{C.hint}</p>
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="debug-directory">
            {C.directory}
          </label>
          <input
            id="debug-directory"
            className="input mono"
            placeholder={C.directoryPlaceholder}
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="debug-requirement">
            {C.requirement}
          </label>
          <textarea
            id="debug-requirement"
            className="textarea"
            rows={3}
            placeholder={C.requirementPlaceholder}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="debug-model">
            {C.model}
          </label>
          <input
            id="debug-model"
            className="input mono"
            placeholder={C.modelPlaceholder}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        {start.isError && <ErrorState error={start.error} />}
        <Button
          type="submit"
          variant="primary"
          pending={start.isPending}
          disabled={directory.trim() === '' || requirement.trim() === ''}
        >
          {C.start}
        </Button>
      </form>
    </Panel>
  );
}
