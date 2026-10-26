import { AGENTS_MD_NOTES_MAX_CHARS, type AgentsMdDTO, type GitFileDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { AGENTS_MD_COPY as C } from '../../copy/projects.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import styles from './project-agents-md.module.css';
import { agentsMdQuery, useStartAgentsMdTask } from './projects.queries.ts';

function FileView({ file }: { file: GitFileDTO }) {
  if ('content' in file) {
    return (
      <div className={styles.doc} data-testid="agents-md">
        <Markdown source={file.content} />
      </div>
    );
  }
  return <p className="hint">{'tooLarge' in file ? C.tooLarge(Math.round(file.size / 1024)) : C.binary}</p>;
}

/** Generate or supplement it with AI, optionally adding the Agent Workflow rules shown on request (40 §7). */
function StartForm({ projectId, agentsMd }: { projectId: string; agentsMd: AgentsMdDTO }) {
  const [notes, setNotes] = useState('');
  const [includeRules, setIncludeRules] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const start = useStartAgentsMdTask();
  const navigate = useNavigate();
  const trimmed = notes.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate(
          { id: projectId, includeRules, ...(trimmed === '' ? {} : { guidance: trimmed }) },
          {
            onSuccess: (task) => {
              toast(C.started);
              void navigate({ to: ROUTES.task, params: { taskId: task.id }, search: {} });
            },
          },
        );
      }}
    >
      <div className="field">
        <label className="label" htmlFor="agents-md-notes">
          {C.notes}
        </label>
        <textarea
          id="agents-md-notes"
          className="textarea"
          rows={3}
          maxLength={AGENTS_MD_NOTES_MAX_CHARS}
          placeholder={C.notesPlaceholder}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="field">
        <div className="row">
          <label className="check grow">
            <input type="checkbox" checked={includeRules} onChange={(e) => setIncludeRules(e.target.checked)} />
            <span>{C.includeRules}</span>
          </label>
          <Button size="sm" variant="ghost" aria-expanded={showRules} onClick={() => setShowRules(!showRules)}>
            {showRules ? C.hideRules : C.previewRules}
          </Button>
        </div>
        <p className="hint">{C.includeRulesHint}</p>
        {showRules && (
          <div className={styles.rules} data-testid="agents-md-rules">
            <Markdown source={agentsMd.rules} />
          </div>
        )}
      </div>
      {start.isError && <ErrorState error={start.error} />}
      <div className="divider" />
      <div className="row">
        <Button type="submit" variant="primary" icon="sparkle" pending={start.isPending}>
          {agentsMd.file === null ? C.generate : C.supplement}
        </Button>
        <span className="hint">{C.hint}</span>
      </div>
    </form>
  );
}

/** The project page's AGENTS.md (40 §7): the committed one on the default branch (D203) and how to change it. */
export function ProjectAgentsMd({ projectId }: { projectId: string }) {
  const agentsMd = useQuery(agentsMdQuery(projectId));
  if (agentsMd.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (agentsMd.isError) return <ErrorState error={agentsMd.error} onRetry={() => void agentsMd.refetch()} />;
  const { branch, file, task } = agentsMd.data;
  return (
    <>
      <p className="hint">{file === null ? C.missing(branch) : C.onBranch(branch)}</p>
      <p className="hint">{C.why}</p>
      {file !== null && <FileView file={file} />}
      {task === null ? (
        <StartForm projectId={projectId} agentsMd={agentsMd.data} />
      ) : (
        <p className={styles.task}>
          <span className="hint">{C.inProgress}</span>
          <Link to={ROUTES.task} params={{ taskId: task.id }} search={{}}>
            <span className="mono">{task.key}</span> · {task.title}
          </Link>
          <TaskBadge group={task.displayGroup} />
        </p>
      )}
    </>
  );
}
