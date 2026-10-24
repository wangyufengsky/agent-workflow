import { ErrorCode, type ProjectDetailDTO } from '@aw/shared';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PROJECTS_COPY } from '../../copy/projects.ts';
import { GitInitConfirm } from './git-init-confirm.tsx';
import { useCreateProject } from './projects.queries.ts';

/**
 * Repository root by path; in Electron a folder picker fills it in. The add button stays a live primary action: an
 * empty path is answered with what to fill in rather than a greyed-out button. A directory in no Git repository is
 * offered to be put under Git (D153).
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
  const noGit = create.error instanceof ApiError && create.error.code === ErrorCode.ProjectPathNoGit;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (repoPath.trim() === '') setMissing(true);
    else create.mutate({ repoPath: repoPath.trim() }, { onSuccess: onAdded });
  };
  const choose = (path: string) => {
    setRepoPath(path);
    setMissing(false);
    create.reset();
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
            onChange={(e) => choose(e.target.value)}
          />
          {bridge !== undefined && (
            <Button
              icon="folder"
              onClick={async () => {
                const dir = await bridge.selectDirectory();
                if (dir !== null) choose(dir);
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
      {noGit && create.variables !== undefined ? (
        <GitInitConfirm repoPath={create.variables.repoPath} onAdded={onAdded} onCancel={() => create.reset()} />
      ) : (
        <>
          {create.isError && <ErrorState error={create.error} />}
          <div className="row">
            <Button type="submit" variant="primary" icon="plus" pending={create.isPending}>
              {PROJECTS_COPY.add}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
