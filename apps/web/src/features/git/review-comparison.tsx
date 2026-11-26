import {
  DiffFileStatus,
  DiffSide,
  type GitComparisonDTO,
  type GitComparisonItemDTO,
  GitComparisonStatus,
  type GitReviewDTO,
  readGitReviewEvidenceOp,
} from '@aw/shared';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { DiffView } from '../../components/diff/diff-view.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_REVIEW_COPY as R } from '../../copy/git-review.ts';
import { markdownComponents, Syntax } from '../designs/design-content.tsx';
import styles from './review-comparison.module.css';

const C = R.comparison;
const FILE_STATUS = {
  [DiffFileStatus.Added]: GitComparisonStatus.Added,
  [DiffFileStatus.Deleted]: GitComparisonStatus.Removed,
  [DiffFileStatus.Modified]: GitComparisonStatus.Modified,
  [DiffFileStatus.Renamed]: GitComparisonStatus.Modified,
} satisfies Record<DiffFileStatus, GitComparisonStatus>;

function useComparisonEvidence(reviewId: string, path: string | undefined, side: DiffSide) {
  return useQuery({
    queryKey: ['gitReviewEvidence', reviewId, path, side],
    queryFn: path === undefined ? skipToken : () => callOperation(readGitReviewEvidenceOp, { reviewId, path, side }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function SourceSide({
  label,
  sha,
  path,
  evidence,
}: {
  label: string;
  sha: string;
  path: string | undefined;
  evidence: ReturnType<typeof useComparisonEvidence>;
}) {
  return (
    <div className={styles.sourceSide}>
      <header>
        <strong>{label}</strong>
        <code title={sha}>{sha.slice(0, 10)}</code>
        {path !== undefined && <code className={styles.path}>{path}</code>}
      </header>
      {path === undefined ? (
        <p className="hint">{R.comparisonNoPath}</p>
      ) : evidence.isPending ? (
        <p className="hint">{COMMON_COPY.loading}</p>
      ) : evidence.isError ? (
        <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />
      ) : evidence.data.content === null ? (
        <p className="hint">{R.unavailable}</p>
      ) : (
        <Syntax path={path} source={evidence.data.content} start={1} label={label} />
      )}
    </div>
  );
}

function SourceComparison({
  review,
  toSha,
  item,
}: {
  review: GitReviewDTO;
  toSha: string;
  item: GitComparisonItemDTO;
}) {
  const from = useComparisonEvidence(review.id, item.fromPath, DiffSide.Old);
  const to = useComparisonEvidence(review.id, item.toPath, DiffSide.New);
  const sameFile = review.files.some(
    (file) =>
      item.fromPath === (file.status === DiffFileStatus.Added ? undefined : (file.oldPath ?? file.path)) &&
      item.toPath === (file.status === DiffFileStatus.Deleted ? undefined : file.path),
  );
  const patch = sameFile ? (to.data?.patch ?? from.data?.patch) : undefined;
  return (
    <>
      <div className={styles.sources}>
        <SourceSide label={C.from} sha={review.from} path={item.fromPath} evidence={from} />
        <SourceSide label={C.to} sha={toSha} path={item.toPath} evidence={to} />
      </div>
      {patch != null && (
        <details className={styles.diff}>
          <summary>{R.comparisonDiff}</summary>
          <DiffView file={patch} mode="unified" />
        </details>
      )}
    </>
  );
}

function ItemGroup({
  title,
  items,
  selected,
  select,
}: {
  title: string;
  items: GitComparisonItemDTO[];
  selected: GitComparisonItemDTO | undefined;
  select: (item: GitComparisonItemDTO) => void;
}) {
  return (
    <section className={styles.group}>
      <h4>{R.tabCount(title, items.length)}</h4>
      {items.length === 0 && <p className="hint">{C.empty}</p>}
      {items.map((item) => {
        const key = JSON.stringify([item.title, item.fromId, item.toId, item.fromPath, item.toPath]);
        const description = (
          <>
            <span className={styles.itemTitle}>
              <span className={styles.tag} data-status={item.status}>
                {C.status[item.status]}
              </span>
              <strong>{item.title}</strong>
            </span>
            {item.detail !== undefined && <span className={styles.description}>{item.detail}</span>}
          </>
        );
        return item.fromPath !== undefined || item.toPath !== undefined ? (
          <button
            key={key}
            type="button"
            className={styles.item}
            aria-pressed={selected === item}
            onClick={() => select(item)}
          >
            {description}
          </button>
        ) : (
          <div key={key} className={styles.item}>
            {description}
          </div>
        );
      })}
    </section>
  );
}

export function ReviewComparison({
  review,
  toSha,
  comparison,
}: {
  review: GitReviewDTO;
  toSha: string;
  comparison: GitComparisonDTO;
}) {
  const [picked, select] = useState<GitComparisonItemDTO>();
  const files = useMemo(
    () =>
      review.files.map(
        (file): GitComparisonItemDTO => ({
          title: file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`,
          status: FILE_STATUS[file.status],
          ...(file.status === DiffFileStatus.Added ? {} : { fromPath: file.oldPath ?? file.path }),
          ...(file.status === DiffFileStatus.Deleted ? {} : { toPath: file.path }),
        }),
      ),
    [review.files],
  );
  const items = [...comparison.sections, ...comparison.transactions];
  const current = picked ?? files[0] ?? items.find((item) => item.fromPath !== undefined || item.toPath !== undefined);
  const endpoints = [
    { label: C.from, sha: review.from, match: comparison.fromMatch },
    { label: C.to, sha: toSha, match: comparison.toMatch },
  ];
  return (
    <section aria-label={C.title} className={styles.report}>
      <div className={styles.endpoints}>
        {endpoints.map(({ label, sha, match }) => (
          <div className={styles.endpoint} key={label} data-match={match}>
            <div className="row wrap">
              <strong>{label}</strong>
              <span className="badge">{C.match[match]}</span>
            </div>
            <code>{sha}</code>
          </div>
        ))}
      </div>
      <div className={styles.layout}>
        <aside className={styles.pane} aria-label={R.comparisonItems}>
          <h3>{R.comparisonItems}</h3>
          <div className={styles.items}>
            <ItemGroup title={C.sections} items={comparison.sections} selected={current} select={select} />
            <ItemGroup title={C.transactions} items={comparison.transactions} selected={current} select={select} />
            <ItemGroup title={C.files} items={files} selected={current} select={select} />
          </div>
        </aside>
        <div className={styles.results}>
          <section className={styles.pane} aria-label={R.comparisonSource}>
            <h3>{R.comparisonSource}</h3>
            <p className="hint">{R.comparisonReadOnly}</p>
            {current === undefined ? (
              <p className="hint">{R.comparisonNoSource}</p>
            ) : (
              <SourceComparison review={review} toSha={toSha} item={current} />
            )}
          </section>
          <section className={styles.pane}>
            <h3>{C.summary}</h3>
            <Markdown source={comparison.summary} components={markdownComponents} />
          </section>
        </div>
      </div>
    </section>
  );
}
