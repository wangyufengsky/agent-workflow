import { DiffSide, type GitFindingDTO, GitReviewTarget } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import type { DiffFocus } from '../../components/diff/diff-view.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';
import { gitCommitQuery, gitDiffFileQuery, gitReviewsQuery } from './git.queries.ts';
import { Avatar } from './git-parts.tsx';
import { ReviewPanel } from './review-panel.tsx';

export type DetailTab = 'files' | 'review';

/** Five squares in the proportion of added to deleted lines. */
function ChangeBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const added = total === 0 ? 0 : Math.round((additions / total) * 5);
  return (
    <span className={styles.bar5} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} data-kind={total === 0 ? undefined : i < added ? 'add' : 'del'} />
      ))}
    </span>
  );
}

async function copySha(sha: string): Promise<void> {
  await navigator.clipboard.writeText(sha);
  toast(C.copied);
}

/**
 * One commit (27 §6.2): message, people, SHA, parents (a merge commit chooses which one it is compared with), the
 * branches containing it, and its changed files or AI review.
 */
export function CommitDetail({
  projectId,
  sha,
  parent,
  tab,
  focus,
  onChange,
}: {
  projectId: string;
  sha: string;
  parent: number | undefined;
  tab: DetailTab;
  focus: { path: string; line: number | undefined; side: 'new' | 'old' } | undefined;
  onChange: (next: {
    parent?: number | undefined;
    tab?: DetailTab;
    focus?: { path: string; line: number | undefined; side: 'new' | 'old' } | undefined;
  }) => void;
}) {
  const commit = useQuery(gitCommitQuery(projectId, sha, parent));
  const reviews = useQuery({ ...gitReviewsQuery(projectId, commit.data?.sha), enabled: commit.data !== undefined });
  if (commit.isPending) return <p className={`hint ${styles.tabBody}`}>{COMMON_COPY.loading}</p>;
  if (commit.isError) return <ErrorState error={commit.error} onRetry={() => void commit.refetch()} />;
  const c = commit.data;
  const additions = c.files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = c.files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const parentIndex = parent ?? 1;
  // Reviews of this commit against the parent shown now.
  const ofThisDiff = (reviews.data ?? []).filter((r) => r.target === GitReviewTarget.Commit && r.from === c.base);
  const latest = ofThisDiff[0];
  const findings = latest?.findings ?? [];
  const locate = (f: GitFindingDTO) =>
    onChange({ tab: 'files', focus: { path: f.path, line: f.line, side: f.side ?? DiffSide.New } });
  const diffFocus: DiffFocus | undefined =
    focus?.line === undefined ? undefined : { line: focus.line, side: focus.side };

  return (
    <section className={styles.detail} aria-label={c.subject} data-testid="git-commit">
      <div className={styles.detailHead}>
        <div className={styles.titleRow}>
          <h2>{c.subject}</h2>
          <button type="button" className="btn brand sm" onClick={() => onChange({ tab: 'review' })}>
            <Icon name="sparkle" />
            {C.reviewCommit}
          </button>
        </div>
        {c.body !== '' && <pre className={styles.body}>{c.body}</pre>}
        <dl className={styles.kv}>
          <dt>{C.authorLabel}</dt>
          <dd>
            <Avatar name={c.authorName} large />
            {c.authorName}
            <span className={styles.small}>
              &lt;{c.authorEmail}&gt; · {formatDateTime(c.authoredAt)}
            </span>
          </dd>
          {(c.committerName !== c.authorName || c.committerEmail !== c.authorEmail) && (
            <>
              <dt>{C.committer}</dt>
              <dd>
                {c.committerName}
                <span className={styles.small}>
                  &lt;{c.committerEmail}&gt; · {formatDateTime(c.committedAt)}
                </span>
              </dd>
            </>
          )}
          <dt>{C.sha}</dt>
          <dd>
            <span className="mono">{c.sha}</span>
            <IconButton icon="copy" label={C.copySha} onClick={() => void copySha(c.sha)} />
          </dd>
          {c.parents.length > 0 && (
            <>
              <dt>{C.parents}</dt>
              <dd>
                {c.parents.length === 1 ? (
                  <span className={styles.ref}>{c.parents[0]?.slice(0, 7)}</span>
                ) : (
                  // biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form fieldset
                  <div className="seg" role="group" aria-label={C.parents}>
                    {c.parents.map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={parentIndex === i + 1}
                        onClick={() => onChange({ parent: i + 1, focus: undefined })}
                      >
                        {C.compareParent(i + 1)} · <span className="mono">{p.slice(0, 7)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </dd>
            </>
          )}
          {c.branches.length > 0 && (
            <>
              <dt>{C.containedIn}</dt>
              <dd>
                {c.branches.map((b) => (
                  <span key={b} className={styles.ref}>
                    {b}
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt>{C.changed}</dt>
          <dd>
            {C.files(c.files.length)}
            <span className={styles.add}>+{additions}</span>
            <span className={styles.del}>−{deletions}</span>
            <ChangeBar additions={additions} deletions={deletions} />
          </dd>
        </dl>
      </div>
      <div className={styles.tabsRow}>
        <div className="tabs" role="tablist">
          {(['files', 'review'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t}
              onClick={() => onChange({ tab: t })}
            >
              {C.tabs[t]}
              <span className={styles.tabCount} data-tone={t === 'review' && findings.length > 0 ? 'warn' : undefined}>
                {t === 'files' ? c.files.length : latest === undefined ? '' : findings.length}
              </span>
            </button>
          ))}
        </div>
        <span className={styles.readOnly}>
          <Icon name="lock" size="sm" />
          {C.readOnly}
        </span>
      </div>
      {tab === 'files' ? (
        <div className={styles.tabBody}>
          <DiffBrowser
            files={c.files}
            fileQuery={gitDiffFileQuery(projectId, c.base, c.sha)}
            selected={focus?.path}
            onSelect={(path) => onChange({ focus: { path, line: undefined, side: DiffSide.New } })}
            marks={(path) =>
              findings
                .filter((f) => f.path === path && f.line !== undefined)
                .map((f) => ({
                  line: f.line ?? 0,
                  side: f.side ?? DiffSide.New,
                  severity: f.severity,
                  title: f.title,
                }))
            }
            focus={diffFocus}
          />
        </div>
      ) : (
        <ReviewPanel
          projectId={projectId}
          target={{ kind: GitReviewTarget.Commit, sha: c.sha, ...(parent === undefined ? {} : { parent }) }}
          reviews={ofThisDiff}
          onLocate={locate}
        />
      )}
    </section>
  );
}
