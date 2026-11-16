import {
  getProjectRuntimeCheckOp,
  type ProjectDetailDTO,
  type ProjectRuntimeCheck,
  startProjectRuntimeCheckOp,
  stopProjectRuntimeCheckOp,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PROJECT_RUNTIME_COPY as C } from '../../copy/projects.ts';

const status = {
  pending: C.pending,
  passed: C.passed,
  failed: C.failed,
  not_configured: C.notConfigured,
  stopped: C.stopped,
  skipped: C.skipped,
};
const reasons = {
  cannot_start: C.cannotStart,
  timeout: C.timeout,
  nonzero_exit: C.nonzeroExit,
  execution_error: C.executionError,
};
function Part({ title, part, target }: { title: string; part: ProjectRuntimeCheck['repository']; target: string }) {
  return (
    <div className="field">
      <strong>
        {title}：{status[part.status]}
      </strong>
      {part.status === 'failed' && (
        <>
          {' '}
          · <a href={target}>{C.settings}</a>
        </>
      )}
      {part.reason && <p>{reasons[part.reason]}</p>}
      {part.output && <pre className="mono">{part.output}</pre>}
    </div>
  );
}
export function ProjectRuntimeCheckPanel({ project }: { project: ProjectDetailDTO }) {
  const [branch, setBranch] = useState(project.defaultBranch);
  const [runCommand, setRunCommand] = useState(project.checkCommand !== null);
  const [runPreview, setRunPreview] = useState(project.preview !== null);
  const client = useQueryClient();
  const key = ['project-runtime-check', project.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => callOperation(getProjectRuntimeCheckOp, { id: project.id }),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  });
  const start = useMutation({
    mutationFn: () =>
      callOperation(startProjectRuntimeCheckOp, {
        id: project.id,
        branch,
        configVersion: project.updatedAt,
        runCommand,
        runPreview,
      }),
    onSuccess: (result) => client.setQueryData(key, result),
  });
  const stop = useMutation({
    mutationFn: () => callOperation(stopProjectRuntimeCheckOp, { id: project.id }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const result = query.data;
  return (
    <div>
      <p className="hint">{C.description}</p>
      <div className="field">
        <label className="label" htmlFor="runtime-branch">
          {C.branch}
        </label>
        <input id="runtime-branch" className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} />
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={runCommand}
            disabled={project.checkCommand === null}
            onChange={(e) => setRunCommand(e.target.checked)}
          />{' '}
          {C.command}
        </label>
        <pre className="mono">{project.checkCommand ?? C.notConfigured}</pre>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={runPreview}
            disabled={project.preview === null}
            onChange={(e) => setRunPreview(e.target.checked)}
          />{' '}
          {C.preview}
        </label>
        <pre className="mono">
          {project.preview === null
            ? C.notConfigured
            : `${project.preview.setupCommand ?? ''}\n${project.preview.command}`}
        </pre>
      </div>
      {query.isError && <ErrorState error={query.error} />}
      {start.isError && <ErrorState error={start.error} />}
      {stop.isError && <ErrorState error={stop.error} />}
      {result?.status === 'running' ? (
        <Button pending={stop.isPending} onClick={() => stop.mutate()}>
          {C.stop}
        </Button>
      ) : (
        <Button variant="primary" disabled={!branch.trim()} pending={start.isPending} onClick={() => start.mutate()}>
          {C.run}
        </Button>
      )}
      {result && (
        <div className="section">
          <p className="hint">
            {C.latest(new Date(result.startedAt).toLocaleString(), result.branch, result.configVersion)}{' '}
            {result.configVersion !== project.updatedAt && C.outdated} {result.status === 'running' && C.running}{' '}
            {result.status === 'interrupted' && C.interrupted}
          </p>
          {result.infrastructureError && (
            <div role="alert">
              <p>{result.infrastructureError.phase === 'cleanup' ? C.cleanupError : C.infrastructureError}</p>
              <pre className="mono">{result.infrastructureError.message}</pre>
            </div>
          )}
          <Part title={C.repository} part={result.repository} target="#project-branch" />
          <Part title={C.command} part={result.command} target="#project-check" />
          <Part title={C.preview} part={result.previewResult} target="#preview-command" />
        </div>
      )}
    </div>
  );
}
