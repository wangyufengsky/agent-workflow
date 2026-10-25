import { ErrorCode, GitMergeStrategy, type GitStatusDTO, HostingSource, type ProjectDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import {
  gitBranchesQuery,
  gitPushPreviewQuery,
  useCreateBranch,
  useCreatePullRequest,
  useDeleteBranch,
  useDraftCommitMessage,
  useMerge,
  useMergeWithAi,
  usePush,
} from './git.queries.ts';

/** The dialog the workbench shows, if any (27 §6.5). */
export type GitDialog =
  | { kind: 'merge'; source: string; target: string }
  | { kind: 'push'; branch: string }
  | { kind: 'newBranch'; startPoint: string }
  | { kind: 'delete'; name: string }
  | { kind: 'pullRequest'; branch: string };

type DialogProps = { project: ProjectDetailDTO; status: GitStatusDTO; onClose: () => void };

function MergeDialog({ project, status, source, target, onClose }: DialogProps & { source: string; target: string }) {
  const navigate = useNavigate();
  const [strategy, setStrategy] = useState<GitMergeStrategy>(GitMergeStrategy.Merge);
  const [message, setMessage] = useState(C.mergeDefaultMessage(source, target));
  const merge = useMerge(project.id);
  const withAi = useMergeWithAi(project.id);
  const draft = useDraftCommitMessage(project.id);
  const blockedByChanges = status.branch === target && !status.clean;
  const conflict = merge.data?.merged === false ? merge.data.conflictFiles : undefined;
  const pick = (next: GitMergeStrategy) => {
    setStrategy(next);
    setMessage(next === GitMergeStrategy.Merge ? C.mergeDefaultMessage(source, target) : '');
  };

  if (conflict !== undefined) {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={C.conflictTitle(target)}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {C.close}
            </Button>
            <Button
              variant="brand"
              icon="sparkle"
              pending={withAi.isPending}
              onClick={() =>
                withAi.mutate(
                  { source, target },
                  {
                    onSuccess: (task) => {
                      toast(C.conflictTaskStarted(task.key));
                      void navigate({ to: ROUTES.task, params: { taskId: task.id } });
                    },
                  },
                )
              }
            >
              {C.conflictAi}
            </Button>
          </>
        }
      >
        <div className="banner warn" role="status" data-testid="git-merge-conflict">
          <Icon name="alert" />
          <div>{C.conflictBody}</div>
        </div>
        <div className={`${styles.list} ${styles.section}`}>
          {conflict.map((file) => (
            <div key={file}>
              <span className={styles.code} data-status="renamed">
                UU
              </span>
              <span className="mono">{file}</span>
            </div>
          ))}
        </div>
        <p className={styles.fine}>{C.conflictAiHint(source, target)}</p>
        <p className={styles.fine}>
          <Icon name="terminal" size="sm" />
          {C.conflictSelfHint(source)}
        </p>
        {withAi.isError && <ErrorState error={withAi.error} />}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.mergeTitle(target)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {C.cancel}
          </Button>
          <Button
            variant="primary"
            icon="merge"
            pending={merge.isPending}
            disabled={blockedByChanges || message.trim() === ''}
            onClick={() =>
              merge.mutate(
                { source, target, strategy, message },
                {
                  onSuccess: (result) => {
                    if (!result.merged) return;
                    toast(C.merged(target));
                    onClose();
                  },
                },
              )
            }
          >
            {C.mergeRun}
          </Button>
        </>
      }
    >
      <div className={styles.flow}>
        <span className={styles.ref}>{source}</span>
        <Icon name="chevRight" size="sm" />
        <span className={styles.ref}>{target}</span>
      </div>
      <fieldset className={styles.strategies}>
        <legend className="label">{C.mergeHow}</legend>
        {[GitMergeStrategy.Merge, GitMergeStrategy.Squash].map((s) => (
          <label key={s} className={styles.option}>
            <input type="radio" name="merge-strategy" checked={strategy === s} onChange={() => pick(s)} />
            <b>{C.strategy[s]}</b>
            <small>{C.strategyHint[s](source, target)}</small>
          </label>
        ))}
      </fieldset>
      <div className={`field ${styles.section}`}>
        <label className="label" htmlFor="merge-message">
          {C.mergeMessage}
        </label>
        <div className="row">
          <input
            id="merge-message"
            className="input mono grow"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {strategy === GitMergeStrategy.Squash && (
            <Button
              icon="sparkle"
              pending={draft.isPending}
              onClick={() =>
                draft.mutate(
                  { from: source, to: target },
                  { onSuccess: (d) => setMessage(d.body === '' ? d.subject : `${d.subject}\n\n${d.body}`) },
                )
              }
            >
              {C.draft}
            </Button>
          )}
        </div>
      </div>
      {blockedByChanges ? (
        <div className={`banner warn ${styles.section}`}>
          <Icon name="alert" />
          <div>{C.mergeBlockedDirty(target)}</div>
        </div>
      ) : (
        <p className={styles.fine}>
          <Icon name="info" size="sm" />
          {C.mergeNote(status.identity?.name ?? '')}
        </p>
      )}
      {merge.isError && <ErrorState error={merge.error} />}
      {draft.isError && <ErrorState error={draft.error} />}
    </Dialog>
  );
}

function PushDialog({ project, branch, onClose }: DialogProps & { branch: string }) {
  const preview = useQuery(gitPushPreviewQuery(project.id, branch));
  const push = usePush(project.id);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.pushTitle(branch)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {C.cancel}
          </Button>
          <Button
            variant="primary"
            icon="arrowUp"
            pending={push.isPending}
            disabled={preview.data === undefined || (preview.data.total === 0 && !preview.data.isNew)}
            onClick={() =>
              push.mutate(branch, {
                onSuccess: () => {
                  toast(C.pushed(branch));
                  onClose();
                },
              })
            }
          >
            {C.pushRun}
          </Button>
        </>
      }
    >
      {preview.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {preview.isError && <ErrorState error={preview.error} />}
      {preview.data !== undefined && (
        <>
          <div className={styles.flow}>
            <span className={styles.ref}>{branch}</span>
            <Icon name="chevRight" size="sm" />
            <span className={styles.ref} data-kind="remote">
              {preview.data.remoteBranch}
            </span>
            <span className={styles.small}>{preview.data.isNew ? C.pushNew : C.pushUpdate}</span>
          </div>
          {preview.data.total === 0 ? (
            <p className="hint">{C.pushNothing}</p>
          ) : (
            <>
              <div className="label">{C.pushCommits(preview.data.total)}</div>
              <div className={styles.list} data-testid="git-push-commits">
                {preview.data.commits.map((c) => (
                  <div key={c.sha}>
                    <span className="mono">{c.sha.slice(0, 7)}</span>
                    <span className="ellipsis">{c.subject}</span>
                  </div>
                ))}
              </div>
              {preview.data.total > preview.data.commits.length && (
                <p className="hint">{C.pushMore(preview.data.total - preview.data.commits.length)}</p>
              )}
            </>
          )}
        </>
      )}
      <p className={styles.fine}>
        <Icon name="lock" size="sm" />
        {project.effectiveHosting === null
          ? C.pushNoteOwn
          : project.effectiveHosting.source === HostingSource.Project
            ? C.pushNoteToken(project.effectiveHosting.repo)
            : C.pushNoteGlobal(project.effectiveHosting.repo)}{' '}
        {C.pushNoForce}
      </p>
      {push.isError && <ErrorState error={push.error} />}
    </Dialog>
  );
}

function NewBranchDialog({ project, startPoint, onClose }: DialogProps & { startPoint: string }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(startPoint);
  const [andSwitch, setAndSwitch] = useState(true);
  const create = useCreateBranch(project.id);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.newBranch}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {C.cancel}
          </Button>
          <Button
            variant="primary"
            pending={create.isPending}
            disabled={name.trim() === '' || from.trim() === ''}
            onClick={() =>
              create.mutate(
                { name: name.trim(), startPoint: from.trim(), switch: andSwitch },
                {
                  onSuccess: () => {
                    toast(C.createdBranch(name.trim()));
                    onClose();
                  },
                },
              )
            }
          >
            {C.create}
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="new-branch-name">
          {C.newBranchName}
        </label>
        <input id="new-branch-name" className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="new-branch-from">
          {C.newBranchFrom}
        </label>
        <input id="new-branch-from" className="input mono" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <label className="row">
        <input type="checkbox" checked={andSwitch} onChange={(e) => setAndSwitch(e.target.checked)} />
        {C.newBranchSwitch}
      </label>
      {create.isError && <ErrorState error={create.error} />}
    </Dialog>
  );
}

function DeleteBranchDialog({ project, name, onClose }: DialogProps & { name: string }) {
  const remove = useDeleteBranch(project.id);
  // `git branch -d` refused: the second step deletes with force (27 §3.4).
  const unmerged = remove.error instanceof ApiError && remove.error.code === ErrorCode.GitBranchNotMerged;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.deleteTitle(name)}
      description={unmerged ? C.deleteUnmerged : C.deleteBody}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {C.cancel}
          </Button>
          <Button
            variant="danger"
            icon="trash"
            pending={remove.isPending}
            onClick={() =>
              remove.mutate(
                { name, force: unmerged },
                {
                  onSuccess: () => {
                    toast(C.deleted(name));
                    onClose();
                  },
                },
              )
            }
          >
            {unmerged ? C.deleteForce : C.deleteRun}
          </Button>
        </>
      }
    >
      {remove.isError && !unmerged && <ErrorState error={remove.error} />}
    </Dialog>
  );
}

function PullRequestDialog({ project, branch, onClose }: DialogProps & { branch: string }) {
  const branches = useQuery(gitBranchesQuery(project.id));
  const last = branches.data?.find((b) => !b.remote && b.name === branch);
  const [base, setBase] = useState(project.defaultBranch);
  const [title, setTitle] = useState(last?.subject ?? branch);
  const [body, setBody] = useState('');
  const create = useCreatePullRequest(project.id);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.prTitle(branch)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {C.cancel}
          </Button>
          {create.data === undefined ? (
            <Button
              variant="primary"
              pending={create.isPending}
              disabled={project.effectiveHosting === null || title.trim() === ''}
              onClick={() => create.mutate({ branch, base, title: title.trim(), body })}
            >
              {C.prRun}
            </Button>
          ) : (
            <a className="btn primary" href={create.data.url} target="_blank" rel="noreferrer">
              <Icon name="external" />
              {C.prOpen}
            </a>
          )}
        </>
      }
    >
      {project.effectiveHosting === null && <p className="hint">{C.prNeedsHosting}</p>}
      {create.data !== undefined && (
        <div className="banner ok" role="status">
          <Icon name="check" />
          <div>{create.data.existed ? C.prExisted : C.prCreated}</div>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="pr-base">
          {C.prBase}
        </label>
        <input id="pr-base" className="input mono" value={base} onChange={(e) => setBase(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="pr-title">
          {C.prTitleField}
        </label>
        <input id="pr-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="pr-body">
          {C.prBody}
        </label>
        <textarea id="pr-body" className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {create.isError && <ErrorState error={create.error} />}
    </Dialog>
  );
}

/** The workbench's dialogs: confirmations of critical operations and the forms of the others (27 §6.5). */
export function GitDialogs({ dialog, ...props }: DialogProps & { dialog: GitDialog | null }) {
  if (dialog === null) return null;
  switch (dialog.kind) {
    case 'merge':
      return <MergeDialog {...props} source={dialog.source} target={dialog.target} />;
    case 'push':
      return <PushDialog {...props} branch={dialog.branch} />;
    case 'newBranch':
      return <NewBranchDialog {...props} startPoint={dialog.startPoint} />;
    case 'delete':
      return <DeleteBranchDialog {...props} name={dialog.name} />;
    case 'pullRequest':
      return <PullRequestDialog {...props} branch={dialog.branch} />;
  }
}
