import { type TaskCodeReviewReport, textLines } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, useCallback, useLayoutEffect, useRef } from 'react';
import { ROUTES } from '../../app/routes.ts';
import diffStyles from '../../components/diff/diff.module.css';
import { DiffView } from '../../components/diff/diff-view.tsx';
import { highlight } from '../../components/diff/highlight.ts';
import { parseUnifiedDiff } from '../../components/diff/parse-diff.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { revealInPane, sizeReadingPane } from '../../components/reveal-in-pane.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { GIT_COPY } from '../../copy/git.ts';
import { TASK_CODE_REVIEW_COPY as C } from '../../copy/task-code-review.ts';
import { gitDiffFileQuery, gitFileQuery } from '../git/git.queries.ts';
import type { ReviewPosition } from './review-reading.ts';
import styles from './task-code-review.module.css';

type Props = {
  project: string;
  position: ReviewPosition;
  report: TaskCodeReviewReport | null;
  pro: boolean;
  active: boolean;
};

function SourceLines({ project, position, report, active }: Props) {
  const { commit, path, line, end } = position;
  const file = useQuery(gitFileQuery(project, commit, path));
  const content = file.data && 'content' in file.data ? file.data.content : undefined;
  const syntax = useQuery({
    queryKey: ['review-syntax', project, commit, path],
    enabled: content !== undefined,
    queryFn: () => highlight(path, content ?? ''),
    staleTime: Infinity,
  });
  const pane = useRef<HTMLDivElement>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    pane.current = el;
    return sizeReadingPane(el);
  }, []);
  useLayoutEffect(() => {
    const target = pane.current?.querySelector('[data-focus="true"]');
    if (active && content !== undefined && line && pane.current && target) revealInPane(pane.current, target);
  }, [content, line, active]);
  if (file.isError) return <ErrorState error={file.error} />;
  if (!file.data) return <p className="hint">{COMMON_COPY.loading}</p>;
  if ('binary' in file.data) return <p className="hint">{GIT_COPY.binary}</p>;
  if ('tooLarge' in file.data) return <p className="hint">{GIT_COPY.tooLarge(Math.ceil(file.data.size / 1024))}</p>;
  const notes = report?.findings.filter((f) => f.location.path === path && f.location.commit === commit) ?? [];
  return (
    <div className={`${styles.reader} ${diffStyles.syntax}`} ref={attach}>
      {textLines(file.data.content).map((source, i) => {
        const n = i + 1;
        return (
          <Fragment key={n}>
            <div
              className={styles.line}
              data-focus={line === n}
              data-marked={line !== undefined && n >= line && n <= (end ?? line)}
            >
              <span>{n}</span>
              <code>
                {syntax.data?.[i]?.map((token, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同行内词元顺序固定。
                  <span key={k} style={{ color: token.color }}>
                    {token.content}
                  </span>
                )) ?? source}
              </code>
            </div>
            {notes
              .filter((f) => f.line === n)
              .map((f) => (
                <p className={styles.annotation} key={f.title}>
                  {C.severity[f.severity]} · <strong>{f.title}</strong>　{f.description}
                </p>
              ))}
          </Fragment>
        );
      })}
    </div>
  );
}

export function ReviewSource(props: Props) {
  const { position: p, report, project, pro } = props;
  const scope = report?.scope;
  const comparing = scope?.kind === 'diff';
  const found = report?.findings.find((f) => f.location.path === p.path && f.location.commit === p.commit);
  const oldSide = comparing && scope.from === p.commit;
  const diffPath = found?.path ?? p.path;
  const diff = useQuery({
    ...gitDiffFileQuery(project, comparing ? scope.from : '', comparing ? scope.to : '')(diffPath),
    enabled: comparing && (oldSide || scope.to === p.commit) && !p.patch,
  });
  const patch = p.patch ?? (diff.data && 'diff' in diff.data ? diff.data.diff : undefined);
  const hasLine =
    patch &&
    (p.line === undefined ||
      parseUnifiedDiff(patch).hunks.some((h) => h.lines.some((l) => (oldSide ? l.oldNo : l.newNo) === p.line)));
  const marks = report?.findings
    .filter((f) => f.path === diffPath || f.location.path === p.path)
    .flatMap((f) =>
      f.line === undefined
        ? []
        : [{ line: f.line, side: f.side ?? 'new', severity: f.severity, title: f.title, description: f.description }],
    );
  return (
    <section className={styles.sheet} aria-label={C.code}>
      <div className={styles.fileHead}>
        <strong className="mono">{C.location(p.path, p.line, p.end)}</strong>
        {p.patch === undefined && <small className="mono hint">{p.commit.slice(0, 8)}</small>}
        {pro && !p.patch && (
          <Link
            className="btn ghost sm"
            to={ROUTES.gitProject}
            params={{ projectId: project }}
            search={{ view: 'files', ref: p.commit, path: p.path, file: true, line: p.line }}
          >
            {C.openInGit}
          </Link>
        )}
      </div>
      {hasLine && patch ? (
        <DiffView
          mode="unified"
          annotate
          file={{ path: p.path, diff: patch }}
          marks={p.patch ? undefined : marks}
          focus={p.line && props.active ? { line: p.line, side: oldSide ? 'old' : 'new' } : undefined}
        />
      ) : (
        <SourceLines {...props} />
      )}
    </section>
  );
}
