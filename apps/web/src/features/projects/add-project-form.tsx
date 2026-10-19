import type { ProjectDetailDTO } from '@aw/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PROJECTS_COPY } from '../../copy/projects.ts';
import { useCreateProject } from './projects.queries.ts';

/** Repository root by path; in Electron a folder picker fills it in. */
export function AddProjectForm({ onAdded }: { onAdded: (project: ProjectDetailDTO) => void }) {
  const [repoPath, setRepoPath] = useState('');
  const create = useCreateProject();
  const bridge = window.aw;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ repoPath: repoPath.trim() }, { onSuccess: onAdded });
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
            onChange={(e) => setRepoPath(e.target.value)}
          />
          {bridge !== undefined && (
            <Button
              icon="folder"
              onClick={async () => {
                const dir = await bridge.selectDirectory();
                if (dir !== null) setRepoPath(dir);
              }}
            >
              {PROJECTS_COPY.chooseFolder}
            </Button>
          )}
        </div>
        <p className="hint">{PROJECTS_COPY.repoPathHint}</p>
      </div>
      {create.isError && <ErrorState error={create.error} />}
      <div className="row">
        <Button
          type="submit"
          variant="primary"
          icon="plus"
          pending={create.isPending}
          disabled={repoPath.trim() === ''}
        >
          {PROJECTS_COPY.add}
        </Button>
      </div>
    </form>
  );
}
