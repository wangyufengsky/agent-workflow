import type { GitBranchDTO, GitCommitDTO, GitReviewDTO } from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Fragment, useMemo } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY, formatMonthDay, formatTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { type GraphRow, layoutGraph } from './commit-graph.ts';
import styles from './git.module.css';
import { gitBranchesQuery, gitLogQuery, gitReviewsQuery, type LogFilter } from './git.queries.ts';
import { Avatar, ReviewBadge } from './git-parts.tsx';

const ROW = 58;
const DAY = 30;
/** Lanes drawn; more are clipped by the column. */
const X = (lane: number) => 12 + lane * 13;

function Graph({ row }: { row: GraphRow }) {
  const y = ROW / 2;
  const lane = (n: number) => styles[`lane${n % 4}`];
  return (
    <svg className={styles.graph} viewBox={`0 0 40 ${ROW}`} aria-hidden="true">
      {row.pass.map((l) => (
        <line key={`p${l}`} className={`${styles.edge} ${lane(l)}`} x1={X(l)} y1={0} x2={X(l)} y2={ROW} />
      ))}
      {row.up && (
        <line className={`${styles.edge} ${lane(row.lane)}`} x1={X(row.lane)} y1={0} x2={X(row.lane)} y2={y} />
      )}
      {row.down && (
        <line className={`${styles.edge} ${lane(row.lane)}`} x1={X(row.lane)} y1={y} x2={X(row.lane)} y2={ROW} />
      )}
      {row.inFrom.map((l) => (
        <path
          key={`i${l}`}
          className={`${styles.edge} ${lane(l)}`}
          d={`M${X(l)} 0 C ${X(l)} ${y - 10}, ${X(row.lane)} ${y - 18}, ${X(row.lane)} ${y}`}
        />
      ))}
      {row.out.map((l) => (
        <path
          key={`o${l}`}
          className={`${styles.edge} ${lane(l)}`}
          d={`M${X(row.lane)} ${y} C ${X(row.lane)} ${y + 18}, ${X(l)} ${y + 10}, ${X(l)} ${ROW}`}
        />
      ))}
      <circle
        className={`${row.out.length > 0 ? styles.mergeDot : styles.dot} ${lane(row.lane)}`}
        cx={X(row.lane)}
        cy={y}
        r={row.out.length > 0 ? 5 : 4.5}
      />
    </svg>
  );
}

function DayLanes({ lanes }: { lanes: readonly number[] }) {
  return (
    <svg className={styles.dayGraph} viewBox={`0 0 40 ${DAY}`} width={40} aria-hidden="true">
      {lanes.map((l) => (
        <line key={l} className={`${styles.edge} ${styles[`lane${l % 4}`]}`} x1={X(l)} y1={0} x2={X(l)} y2={DAY} />
      ))}
    </svg>
  );
}

/** `今天` / `昨天` / `10月20日周一`, by the local calendar day. */
function dayOf(ms: number, now: number): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return `${C.today} · ${formatMonthDay(ms)}`;
  if (day(ms) === day(now - 86_400_000)) return `${C.yesterday} · ${formatMonthDay(ms)}`;
  return formatMonthDay(ms);
}

/** Branch labels at a commit: HEAD first, then local, then remote branches. */
function refsAt(commit: GitCommitDTO, branches: readonly GitBranchDTO[]) {
  return branches
    .filter((b) => b.commit === commit.sha)
    .sort((a, b) => Number(b.current) - Number(a.current) || Number(a.remote) - Number(b.remote));
}

/** The log of a ref, grouped by day, with its graph and the latest review of each commit (27 §6.2). */
export function CommitList({
  projectId,
  refName,
  filter,
  selected,
  onSelect,
}: {
  projectId: string;
  refName: string;
  filter: LogFilter;
  selected: string | undefined;
  onSelect: (sha: string) => void;
}) {
  const log = useInfiniteQuery(gitLogQuery(projectId, refName, filter));
  const branches = useQuery(gitBranchesQuery(projectId)).data ?? [];
  const reviews = useQuery(gitReviewsQuery(projectId)).data ?? [];
  const commits = useMemo(() => log.data?.pages.flatMap((p) => p.items) ?? [], [log.data]);
  const rows = useMemo(() => layoutGraph(commits), [commits]);
  const latestReview = new Map<string, GitReviewDTO>();
  // Reviews come newest first: the first one of a commit is its latest.
  for (const r of reviews) if (r.to !== null && !latestReview.has(r.to)) latestReview.set(r.to, r);
  const now = Date.now();
  const filtered = filter.author !== undefined || filter.search !== undefined;

  return (
    <section className={styles.listCol} aria-label={C.commits}>
      <div className={styles.colHead}>
        <b>{C.commits}</b>
        <span className={`${styles.sub} mono`}>{refName}</span>
      </div>
      {log.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} />}
      {log.isSuccess && commits.length === 0 && <p className="hint">{filtered ? C.noMatch : C.noCommits}</p>}
      {commits.map((commit, i) => {
        const row = rows[i];
        if (row === undefined) return null;
        const previous = commits[i - 1];
        const day = dayOf(commit.authoredAt, now);
        const newDay = previous === undefined || dayOf(previous.authoredAt, now) !== day;
        const review = latestReview.get(commit.sha);
        return (
          <Fragment key={commit.sha}>
            {newDay && (
              <div className={styles.day}>
                <DayLanes lanes={rows[i - 1]?.after ?? []} />
                {day}
              </div>
            )}
            <button
              type="button"
              className={styles.commit}
              aria-current={commit.sha === selected}
              data-testid="git-log-entry"
              onClick={() => onSelect(commit.sha)}
            >
              <Graph row={row} />
              <div className={styles.commitText}>
                <div className={styles.line1}>
                  {refsAt(commit, branches).map((b) => (
                    <span
                      key={b.name}
                      className={styles.ref}
                      data-kind={b.current ? 'head' : b.remote ? 'remote' : undefined}
                    >
                      {b.current ? `HEAD → ${b.name}` : b.name}
                    </span>
                  ))}
                  <span className={styles.subjectText}>{commit.subject}</span>
                  {review !== undefined && <ReviewBadge review={review} />}
                </div>
                <div className={styles.line2}>
                  <Avatar name={commit.authorName} />
                  {commit.authorName} · {formatTime(commit.authoredAt)}
                  <span className={styles.sha}>{commit.sha.slice(0, 7)}</span>
                </div>
              </div>
            </button>
          </Fragment>
        );
      })}
      {log.hasNextPage ? (
        <div className={styles.more}>
          <Button size="sm" pending={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {C.loadingMore}
          </Button>
        </div>
      ) : (
        log.isSuccess && commits.length > 0 && <p className={styles.more}>{C.noMore}</p>
      )}
    </section>
  );
}
