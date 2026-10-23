import { type ProjectDetailDTO, type ProjectPreview, trialPreviewOp } from '@aw/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { PREVIEW_COPY as C } from '../../copy/browser.ts';
import styles from './project-preview.module.css';
import { useUpdateProject } from './projects.queries.ts';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

/** The log tail a failed start carries (`PREVIEW_START_FAILED.details.logTail`). */
function logTailOf(error: unknown): string | null {
  return error instanceof ApiError && typeof error.details?.logTail === 'string' ? error.details.logTail : null;
}

/**
 * The project's page preview settings (29 §8.5): the start command and key pages in front, the rest under「更多设置」;
 * a trial run starts it once in the main workspace.
 */
export function ProjectPreviewForm({ project }: { project: ProjectDetailDTO }) {
  const saved = project.preview;
  const [command, setCommand] = useState(saved?.command ?? '');
  const [pages, setPages] = useState((saved?.pages ?? ['/']).join('\n'));
  const [setupCommand, setSetupCommand] = useState(saved?.setupCommand ?? '');
  const [readyPath, setReadyPath] = useState(saved?.readyPath ?? '/');
  const [extraOrigins, setExtraOrigins] = useState((saved?.extraOrigins ?? []).join('\n'));
  const update = useUpdateProject();
  const trial = useMutation({ mutationFn: () => callOperation(trialPreviewOp, { projectId: project.id }) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    trial.reset();
    const preview: ProjectPreview | null =
      command.trim() === ''
        ? null
        : {
            command: command.trim(),
            setupCommand: setupCommand.trim() === '' ? null : setupCommand.trim(),
            readyPath: readyPath.trim(),
            pages: lines(pages),
            extraOrigins: lines(extraOrigins),
          };
    // Saving remounts this form (it is keyed by the project's update time), so the toast follows the promise:
    // per-call callbacks of an unmounted mutation do not run.
    update.mutateAsync({ id: project.id, preview }).then(
      () => toast(C.saved),
      () => undefined,
    );
  };
  const failedLog = logTailOf(trial.error);

  return (
    <form onSubmit={submit}>
      <p className={`hint ${styles.lede}`}>{C.lede}</p>
      <div className="field">
        <label className="label" htmlFor="preview-command">
          {C.command}
        </label>
        <input
          id="preview-command"
          className="input mono"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <p className="hint">{C.commandHint}</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="preview-pages">
          {C.pages}
        </label>
        <textarea
          id="preview-pages"
          className="textarea mono"
          rows={3}
          value={pages}
          onChange={(e) => setPages(e.target.value)}
        />
        <p className="hint">{C.pagesHint}</p>
      </div>
      <details className={`adv ${styles.more}`}>
        <summary>
          <span className="chev">
            <Icon name="chevron" size="sm" />
          </span>
          {C.more}
        </summary>
        <div className="field">
          <label className="label" htmlFor="preview-setup">
            {C.setupCommand}
          </label>
          <input
            id="preview-setup"
            className="input mono"
            value={setupCommand}
            onChange={(e) => setSetupCommand(e.target.value)}
          />
          <p className="hint">{C.setupCommandHint}</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="preview-ready">
            {C.readyPath}
          </label>
          <input
            id="preview-ready"
            className="input mono"
            value={readyPath}
            onChange={(e) => setReadyPath(e.target.value)}
          />
          <p className="hint">{C.readyPathHint}</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="preview-origins">
            {C.extraOrigins}
          </label>
          <textarea
            id="preview-origins"
            className="textarea mono"
            rows={2}
            value={extraOrigins}
            onChange={(e) => setExtraOrigins(e.target.value)}
          />
          <p className="hint">{C.extraOriginsHint}</p>
        </div>
      </details>
      {update.isError && <ErrorState error={update.error} />}
      {trial.isSuccess && (
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div className="grow col">
            <span>{C.trialOk(trial.data.url)}</span>
            <span className="hint">{C.log}</span>
            <pre className={styles.log}>{trial.data.logTail}</pre>
          </div>
        </div>
      )}
      {trial.isError && <ErrorState error={trial.error} />}
      {failedLog !== null && (
        <>
          <span className="hint">{C.log}</span>
          <pre className={styles.log}>{failedLog}</pre>
        </>
      )}
      <div className="divider" />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" pending={update.isPending}>
          {C.save}
        </Button>
        <Button
          type="button"
          icon="play"
          pending={trial.isPending}
          disabled={saved === null}
          title={C.trialHint}
          onClick={() => trial.mutate()}
        >
          {C.trial}
        </Button>
      </div>
    </form>
  );
}
