import {
  DiffSide,
  type GitReviewDTO,
  GitReviewEvidenceState,
  GitReviewTarget,
  readGitReviewEvidenceOp,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { DiffView } from '../../components/diff/diff-view.tsx';
import { parseUnifiedDiff } from '../../components/diff/parse-diff.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY } from '../../copy/git.ts';
import { GIT_REVIEW_COPY as C } from '../../copy/git-review.ts';
import { Syntax } from '../designs/design-content.tsx';
import styles from './review-result.module.css';

export type EvidenceLocation = {
  path: string;
  line: number | undefined;
  end: number | undefined;
  side: DiffSide;
};

export function ReviewEvidenceDialog({
  review,
  location,
  close,
}: {
  review: GitReviewDTO;
  location: EvidenceLocation;
  close: () => void;
}) {
  const [view, setView] = useState<DiffSide | 'diff'>('diff');
  const side = view === 'diff' ? location.side : view;
  const canChange = review.target === GitReviewTarget.Worktree && side === DiffSide.New;
  const evidence = useQuery({
    staleTime: canChange ? 0 : Number.POSITIVE_INFINITY,
    refetchOnMount: canChange ? 'always' : false,
    queryKey: ['gitReviewEvidence', review.id, location.path, side],
    queryFn: () => callOperation(readGitReviewEvidenceOp, { reviewId: review.id, path: location.path, side }),
  });
  const line = side === location.side ? location.line : undefined;
  const selection = line === undefined ? undefined : { start: line, end: location.end ?? line };
  const waiting = evidence.isPending || (canChange && evidence.isFetching);
  const info = waiting || evidence.isError ? undefined : evidence.data;
  const patch = view === 'diff' ? (info?.patch ?? null) : null;
  const inHunk =
    line === undefined ||
    (patch !== null &&
      'diff' in patch &&
      parseUnifiedDiff(patch.diff).hunks.some(({ lines }) =>
        lines.some((row) => (side === DiffSide.Old ? row.oldNo : row.newNo) === line),
      ));
  const showSource = patch === null || !inHunk;
  const changed = review.files.some(({ path, oldPath }) => path === location.path || oldPath === location.path);
  const labels = { diff: C.sourceDiff, ...C.sourceVersion };

  return (
    <Dialog
      open
      title={C.sourceTitle(location.path)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      footer={<Button onClick={close}>{GIT_COPY.close}</Button>}
    >
      <div className={styles.evidencePane}>
        <p className="hint mono" title={`${review.from} → ${review.to ?? ''}`}>
          {GIT_COPY.scope(review.from, review.to)}
        </p>
        <fieldset className={`seg ${styles.evidenceSwitcher}`} aria-label={C.source}>
          {(['diff', DiffSide.Old, DiffSide.New] as const).map((choice) => (
            <button key={choice} type="button" aria-pressed={view === choice} onClick={() => setView(choice)}>
              {labels[choice]}
            </button>
          ))}
        </fieldset>
        {waiting && <p className="hint">{COMMON_COPY.loading}</p>}
        {evidence.isError && <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />}
        {info?.state === GitReviewEvidenceState.Changed && (
          <p role="status" className="banner warn">
            {C.worktreeChanged}
          </p>
        )}
        {info !== undefined && info.state !== GitReviewEvidenceState.Changed && (
          <>
            {patch !== null && (
              <DiffView file={patch} mode="unified" focus={line === undefined ? undefined : { line, side }} />
            )}
            {view === 'diff' && patch === null && info.state === GitReviewEvidenceState.Available && (
              <p className="hint">{changed ? C.patchUnavailable : C.noPatch}</p>
            )}
            {showSource &&
              (info.content === null ? (
                <p className="hint" role="status">
                  {C.unavailable}
                </p>
              ) : (
                <Syntax
                  key={side}
                  path={info.path}
                  source={info.content}
                  start={1}
                  selection={selection}
                  label={labels[side]}
                />
              ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
