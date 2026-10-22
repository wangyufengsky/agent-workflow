import {
  type DiffFile,
  DiffFileStatus,
  DiffSide,
  type GitFindingDTO,
  GitReviewTarget,
  type GitStatusDTO,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { FileDiff } from '../../components/diff/diff-browser.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import {
  gitChangeFileQuery,
  gitChangesQuery,
  gitReviewsQuery,
  useCommit,
  useDraftCommitMessage,
  useStage,
  useUnstage,
} from './git.queries.ts';
import { GitMenu } from './git-menu.tsx';
import { Avatar, LineCounts, StatusCode } from './git-parts.tsx';
import { ReviewPanel } from './review-panel.tsx';

export type ChangeSide = 'staged' | 'unstaged';
export type ChangePick = { path: string; side: ChangeSide };

function ChangeRow({
  file,
  side,
  current,
  onPick,
  onToggle,
}: {
  file: DiffFile;
  side: ChangeSide;
  current: boolean;
  onPick: () => void;
  onToggle: () => void;
}) {
  const slash = file.path.lastIndexOf('/');
  // In the unstaged group an addition can only be an untracked file.
  const untracked = side === 'unstaged' && file.status === DiffFileStatus.Added;
  return (
    <div className={styles.change} aria-current={current} data-testid="git-change">
      <button type="button" className={styles.changePick} onClick={onPick}>
        <StatusCode status={file.status} untracked={untracked} />
        <span className={styles.changeName}>
          <span className={styles.file}>{file.path.slice(slash + 1)}</span>
          {file.oldPath !== undefined ? (
            <span className={styles.dir}>{C.renamedFrom(file.oldPath)}</span>
          ) : (
            slash > 0 && <span className={styles.dir}>{file.path.slice(0, slash + 1)}</span>
          )}
        </span>
      </button>
      <LineCounts file={file} />
      <IconButton
        className={styles.toggle}
        icon={side === 'staged' ? 'x' : 'plus'}
        label={side === 'staged' ? C.unstageFile(file.path) : C.stageFile(file.path)}
        onClick={onToggle}
      />
    </div>
  );
}

/** The rail's list of uncommitted changes, staged and unstaged (27 §6.3). */
export function ChangesList({
  projectId,
  picked,
  onPick,
}: {
  projectId: string;
  picked: ChangePick | undefined;
  onPick: (pick: ChangePick) => void;
}) {
  const changes = useQuery(gitChangesQuery(projectId));
  const stage = useStage(projectId);
  const unstage = useUnstage(projectId);
  if (changes.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (changes.isError) return <ErrorState error={changes.error} onRetry={() => void changes.refetch()} />;
  const { staged, unstaged, conflicted } = changes.data;
  const group = (side: ChangeSide, files: readonly DiffFile[]) => (
    <>
      <div className={styles.group}>
        {side === 'staged' ? C.staged : C.unstaged} {files.length}
        {files.length > 0 && (
          <button type="button" onClick={() => (side === 'staged' ? unstage : stage).mutate(files.map((f) => f.path))}>
            {side === 'staged' ? C.unstageAll : C.stageAll}
          </button>
        )}
      </div>
      {files.map((f) => (
        <ChangeRow
          key={f.path}
          file={f}
          side={side}
          current={picked?.path === f.path && picked.side === side}
          onPick={() => onPick({ path: f.path, side })}
          onToggle={() => (side === 'staged' ? unstage : stage).mutate([f.path])}
        />
      ))}
    </>
  );
  return (
    <div data-testid="git-changes">
      {staged.length + unstaged.length + conflicted.length === 0 && <p className="hint">{C.noChanges}</p>}
      {conflicted.length > 0 && (
        <>
          <div className={styles.group}>
            {C.conflicted} {conflicted.length}
          </div>
          {conflicted.map((path) => (
            <div key={path} className={styles.change} data-testid="git-conflicted">
              <span className={styles.code} data-status="deleted">
                {C.conflictCode}
              </span>
              <span className={`${styles.changeName} mono`}>{path}</span>
            </div>
          ))}
          <p className="hint">{C.conflictedHint}</p>
        </>
      )}
      {group('staged', staged)}
      {group('unstaged', unstaged)}
      {(stage.isError || unstage.isError) && <ErrorState error={stage.error ?? unstage.error} />}
    </div>
  );
}

function CommitPanel({
  projectId,
  status,
  stagedCount,
  unstagedCount,
  onPush,
}: {
  projectId: string;
  status: GitStatusDTO;
  stagedCount: number;
  unstagedCount: number;
  onPush: (branch: string) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [drafted, setDrafted] = useState(false);
  const commit = useCommit(projectId);
  const draft = useDraftCommitMessage(projectId);
  const branch = status.branch ?? C.detached;
  const message = body.trim() === '' ? subject.trim() : `${subject.trim()}\n\n${body.trim()}`;
  const run = (andPush: boolean) =>
    commit.mutate(message, {
      onSuccess: (created) => {
        toast(C.committed(created.sha));
        setSubject('');
        setBody('');
        setDrafted(false);
        if (andPush && status.branch !== null) onPush(status.branch);
      },
    });
  const canCommit = stagedCount > 0 && subject.trim() !== '' && status.identity !== null;
  return (
    <aside className={styles.commitPanel} aria-label={C.commitTo(branch)}>
      <h3>
        <Icon name="git" />
        {C.commitTo(branch)}
      </h3>
      <input
        className="input"
        aria-label={C.commitSubject}
        placeholder={C.commitSubject}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        className="input"
        aria-label={C.commitBody}
        placeholder={C.commitBody}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className={styles.draftNote}>
        {draft.isPending ? C.drafting : drafted ? C.drafted : ''}
        <span className={styles.spacer} />
        <Button
          size="sm"
          variant="ghost"
          icon="sparkle"
          pending={draft.isPending}
          disabled={stagedCount === 0}
          onClick={() =>
            draft.mutate(undefined, {
              onSuccess: (d) => {
                setSubject(d.subject);
                setBody(d.body);
                setDrafted(true);
              },
            })
          }
        >
          {drafted ? C.redraft : C.draft}
        </Button>
      </div>
      {draft.isError && <ErrorState error={draft.error} />}
      {status.identity === null ? (
        <p className="hint">{C.noIdentity}</p>
      ) : (
        <div className={styles.who}>
          <Avatar name={status.identity.name} />
          {C.authorIs(status.identity.name, status.identity.email)}
        </div>
      )}
      <div className={styles.split}>
        <Button
          variant="primary"
          icon="check"
          pending={commit.isPending}
          disabled={!canCommit}
          onClick={() => run(false)}
        >
          {C.commitN(stagedCount)}
        </Button>
        <GitMenu
          label={C.commitMenu}
          className={`btn primary ${styles.splitToggle}`}
          trigger={<Icon name="chevDown" size="sm" />}
          items={[
            { label: C.commitN(stagedCount), hint: C.commitOnly, disabled: !canCommit, onSelect: () => run(false) },
            {
              label: C.commitAndPush,
              hint: C.commitAndPushHint,
              disabled: !canCommit || status.branch === null,
              onSelect: () => run(true),
            },
          ]}
        />
      </div>
      <p className="hint">{C.commitHint(unstagedCount)}</p>
      {commit.isError && <ErrorState error={commit.error} />}
    </aside>
  );
}

/** The main area of the changes view: the picked file's diff or the worktree's review, and the commit panel. */
export function ChangesMain({
  projectId,
  status,
  picked,
  showReview,
  onShowReview,
  onPick,
  onPush,
}: {
  projectId: string;
  status: GitStatusDTO;
  picked: ChangePick | undefined;
  showReview: boolean;
  onShowReview: (show: boolean) => void;
  onPick: (pick: ChangePick) => void;
  onPush: (branch: string) => void;
}) {
  const changes = useQuery(gitChangesQuery(projectId));
  const reviews = useQuery(gitReviewsQuery(projectId));
  const [focus, setFocus] = useState<GitFindingDTO | undefined>(undefined);
  const staged = changes.data?.staged ?? [];
  const unstaged = changes.data?.unstaged ?? [];
  const first: ChangePick | undefined =
    staged[0] !== undefined
      ? { path: staged[0].path, side: 'staged' }
      : unstaged[0] !== undefined
        ? { path: unstaged[0].path, side: 'unstaged' }
        : undefined;
  const listed = (p: ChangePick) => (p.side === 'staged' ? staged : unstaged).some((f) => f.path === p.path);
  const shown = picked !== undefined && listed(picked) ? picked : first;
  // Reviews of the uncommitted changes on top of the current commit.
  const worktreeReviews = (reviews.data ?? []).filter(
    (r) => r.target === GitReviewTarget.Worktree && r.from === status.commit,
  );
  const findingsOf = (path: string) =>
    (worktreeReviews[0]?.findings ?? [])
      .filter((f) => f.path === path && f.line !== undefined)
      .map((f) => ({ line: f.line ?? 0, side: f.side ?? DiffSide.New, severity: f.severity, title: f.title }));

  return (
    <div className={styles.changes}>
      <section className={styles.diffPane} aria-label={shown?.path}>
        <div className={styles.diffHead}>
          {showReview ? (
            <b>{C.reviewChanges}</b>
          ) : (
            shown !== undefined && (
              <>
                <span className="mono ellipsis">{shown.path}</span>
                <span className="badge">{shown.side === 'staged' ? C.stagedVsHead : C.unstagedVsIndex}</span>
              </>
            )
          )}
          <span className={styles.spacer} />
          {showReview && (
            <Button size="sm" variant="ghost" onClick={() => onShowReview(false)}>
              {C.close}
            </Button>
          )}
        </div>
        {showReview ? (
          <ReviewPanel
            projectId={projectId}
            target={{ kind: GitReviewTarget.Worktree }}
            reviews={worktreeReviews}
            onLocate={(f) => {
              onShowReview(false);
              setFocus(f);
              onPick({ path: f.path, side: staged.some((s) => s.path === f.path) ? 'staged' : 'unstaged' });
            }}
          />
        ) : shown === undefined ? (
          <p className="hint">{C.noChanges}</p>
        ) : (
          <FileDiff
            path={shown.path}
            query={gitChangeFileQuery(projectId, shown.side)}
            mode="unified"
            marks={findingsOf(shown.path)}
            focus={
              focus?.path === shown.path && focus.line !== undefined
                ? { line: focus.line, side: focus.side ?? DiffSide.New }
                : undefined
            }
          />
        )}
      </section>
      <div>
        <CommitPanel
          projectId={projectId}
          status={status}
          stagedCount={staged.length}
          unstagedCount={unstaged.length}
          onPush={onPush}
        />
        <div className={styles.commitPanel}>
          <Button icon="sparkle" disabled={staged.length + unstaged.length === 0} onClick={() => onShowReview(true)}>
            {C.reviewChanges}
          </Button>
        </div>
      </div>
    </div>
  );
}
