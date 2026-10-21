import type { ProjectDetailDTO } from '@aw/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PROJECTS_COPY } from '../../copy/projects.ts';
import { useCreateProject } from './projects.queries.ts';

/**
 * Repository root by path; in Electron a folder picker fills it in. The add button stays a live primary action: an
 * empty path is answered with what to fill in rather than a greyed-out button.
 */
export function AddProjectForm({
  initialRepoPath = '',
  onAdded,
}: {
  /** Prefilled by the assistant's `open_form` (15 §5). */
  initialRepoPath?: string;
  onAdded: (project: ProjectDetailDTO) => void;
}) {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [missing, setMissing] = useState(false);
  const create = useCreateProject();
  const bridge = window.aw;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (repoPath.trim() === '') setMissing(true);
    else create.mutate({ repoPath: repoPath.trim() }, { onSuccess: onAdded });
  };

  return (
    <form className="col" onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="repo-path">
          {PROJECTS_COPY.repoPath}
        </label>
        <div className="row">
          <input
            id="repo-path"
            className="input mono"
            placeholder={PROJECTS_COPY.repoPathPlaceholder}
            value={repoPath}
            aria-invalid={missing}
            aria-describedby="repo-path-hint"
            onChange={(e) => {
              setRepoPath(e.target.value);
              setMissing(false);
            }}
          />
          {bridge !== undefined && (
            <Button
              icon="folder"
              onClick={async () => {
                const dir = await bridge.selectDirectory();
                if (dir !== null) {
                  setRepoPath(dir);
                  setMissing(false);
                }
              }}
            >
              {PROJECTS_COPY.chooseFolder}
            </Button>
          )}
        </div>
        <p id="repo-path-hint" className={missing ? 'error-text' : 'hint'}>
          {missing ? PROJECTS_COPY.repoPathMissing : PROJECTS_COPY.repoPathHint}
        </p>
      </div>
      {create.isError && <ErrorState error={create.error} />}
      <div className="row">
        <Button type="submit" variant="primary" icon="plus" pending={create.isPending}>
          {PROJECTS_COPY.add}
        </Button>
      </div>
    </form>
  );
}
