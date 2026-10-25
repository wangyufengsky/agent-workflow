import { type AttemptDTO, AttemptStatus, ErrorCode, type TranscriptEntry, TranscriptEntryKind } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { ATTEMPT_STATUS_LABEL, STREAM_COPY as C, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { attemptQuery, attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import { ActionBar, ActionGroup, StreamAttemptContext } from './action-bar.tsx';
import { ClampedText } from './clamped-text.tsx';
import { LatestButton } from './latest-button.tsx';
import styles from './stream.module.css';
import { type StreamItem, streamItems } from './stream-items.ts';
import { ThinkingBlock } from './thinking-block.tsx';
import { useStickToBottom } from './use-stick-to-bottom.ts';

/** The box's fixed height (25 §3): beside the canvas in the drawer, on a page, inside a card, in the task's side panel. */
export type StreamSize = 'drawer' | 'page' | 'card' | 'side';

type BoxState = 'running' | 'done' | 'failed' | 'stopped';
const boxState = (a: AttemptDTO): BoxState => {
  if (a.endedAt === null) return 'running';
  if (a.status === AttemptStatus.Succeeded) return 'done';
  return a.status === AttemptStatus.Failed ? 'failed' : 'stopped';
};
const STATE_ICON = { done: 'check', failed: 'x', stopped: 'stop' } as const;
/** What we sent the session folds to this many lines (25 §4.4). */
const PROMPT_LINES = 4;

function Prompt({ text }: { text: string }) {
  return (
    <div className={styles.prompt}>
      <span className={styles.promptLabel}>
        <Icon name="terminal" size="sm" />
        {C.prompt}
      </span>
      <ClampedText text={text} lines={PROMPT_LINES} className={styles.promptText} />
    </div>
  );
}

const Item = memo(function Item({ item, pro }: { item: StreamItem; pro: boolean }) {
  switch (item.kind) {
    case 'text':
      return (
        <div className={styles.text} data-writing={item.writing}>
          <Markdown source={item.text} />
        </div>
      );
    case 'thinking':
      return <ThinkingBlock text={item.text} seconds={item.seconds} writing={item.writing} />;
    case 'action':
      return <ActionBar item={item} pro={pro} />;
    case 'group':
      return <ActionGroup actions={item.actions} pro={pro} />;
    case 'prompt':
      return <Prompt text={item.text} />;
    case 'wait':
      return (
        <p className={styles.wait}>
          <Icon name="lock" size="sm" />
          <span className="grow">{C.wait(item.permission, item.patterns.join(' '))}</span>
          {item.waiting && (
            <Link to={ROUTES.inbox} className="btn sm">
              {C.goHandle}
            </Link>
          )}
        </p>
      );
    case 'progress':
      return (
        <p className={styles.notice}>
          {C.progress}
          <Markdown inline source={item.text} />
        </p>
      );
    case 'notice':
      if (item.waiting)
        return (
          <p className={styles.wait}>
            <Icon name="alert" size="sm" />
            <span className="grow">{TRANSCRIPT_SYSTEM_LABEL[item.event]}</span>
            <Link to={ROUTES.inbox} className="btn sm">
              {C.goHandle}
            </Link>
          </p>
        );
      return (
        <p className={styles.notice}>
          {item.detail === undefined
            ? TRANSCRIPT_SYSTEM_LABEL[item.event]
            : C.noticeDetail(TRANSCRIPT_SYSTEM_LABEL[item.event], item.detail)}
        </p>
      );
    case 'error':
      return (
        <p className={styles.error}>
          <Icon name="alert" size="sm" />
          <span className="grow">
            {ERROR_COPY[item.error.code]}
            {pro ? (
              <span className="mono">
                {' '}
                · {item.error.code} · {item.error.message}
              </span>
            ) : (
              // The model service's own words say what went wrong (D163).
              item.error.code === ErrorCode.AttemptSessionError && <span className="mono"> {item.error.message}</span>
            )}
          </span>
        </p>
      );
  }
});

/** Text grows without a new item, so following the bottom watches the last entry's length too. */
const versionOf = (entries: readonly TranscriptEntry[]) => {
  const last = entries.at(-1);
  return `${entries.length}:${last !== undefined && 'partId' in last ? last.data.text.length : 0}`;
};

function Box({
  attempt,
  entries,
  more,
  title,
  summary,
  meta,
  actions,
  pro,
  size,
  testId,
  foldOnEnd,
}: {
  attempt: AttemptDTO;
  entries: readonly TranscriptEntry[];
  more: ReactNode;
} & StreamProps) {
  const state = boxState(attempt);
  const ended = state !== 'running';
  const stored = useUiStore((s) => s.streamOpen[attempt.id]);
  const setStreamOpen = useUiStore((s) => s.setStreamOpen);
  // A stream that has ended opens folded; one that ends while watched stays open unless it folds on end (25 §4.5).
  const [openedRunning] = useState(!ended);
  const open = stored ?? (foldOnEnd === true ? !ended : openedRunning);
  const items = useMemo(
    () => streamItems(entries, { directory: attempt.directory, pro, ended }),
    [entries, attempt.directory, pro, ended],
  );
  // Items there when the box opened are shown at once; later ones fade in.
  const [initial] = useState(() => new Set(items.map((i) => i.key)));
  const stick = useStickToBottom(`${open}:${versionOf(entries)}`, items.length);
  const counted = {
    thoughts: entries.filter((e) => e.kind === TranscriptEntryKind.Reasoning).length,
    actions: entries.filter((e) => e.kind === TranscriptEntryKind.ToolCall).length,
  };
  const defaultSummary = ended
    ? C.summary(
        ATTEMPT_STATUS_LABEL[attempt.status],
        counted.thoughts,
        counted.actions,
        C.duration((attempt.endedAt ?? attempt.startedAt) - attempt.startedAt),
      )
    : null;

  return (
    <section className={styles.box} data-state={state} data-open={open} data-testid={testId ?? 'conversation-stream'}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setStreamOpen(attempt.id, !open)}
        >
          <span className={styles.state} aria-label={ATTEMPT_STATUS_LABEL[attempt.status]} role="img">
            {state === 'running' ? <span className="spin" /> : <Icon name={STATE_ICON[state]} size="sm" />}
          </span>
          <span className={styles.title}>{title}</span>
          {!ended && attempt.progress !== null && (
            <span className={styles.now}>
              <Markdown inline source={attempt.progress} />
            </span>
          )}
          <span className={styles.meta}>
            {summary ?? defaultSummary}
            {(summary ?? defaultSummary) !== null && meta !== undefined && ' · '}
            {meta}
          </span>
          <span className={styles.chevron} aria-hidden="true">
            <Icon name="chevRight" size="sm" />
          </span>
        </button>
        {actions}
      </div>
      {open && (
        <div className={styles.body} data-size={size}>
          <div className={styles.scroll} ref={stick.ref} onScroll={stick.onScroll} data-testid="stream-scroll">
            {pro && attempt.error !== null && (
              <p className={styles.error}>
                <Icon name="alert" size="sm" />
                <span className="grow mono">
                  {attempt.error.code} · {attempt.error.message}
                </span>
              </p>
            )}
            {items.length === 0 && <p className="hint">{C.empty}</p>}
            <StreamAttemptContext.Provider value={attempt.id}>
              {items.map((item) => (
                <div key={item.key} className={styles.item} data-enter={!initial.has(item.key)}>
                  <Item item={item} pro={pro} />
                </div>
              ))}
            </StreamAttemptContext.Provider>
            {more}
          </div>
          {!stick.following && <LatestButton unseen={stick.unseen} onClick={stick.toLatest} />}
        </div>
      )}
    </section>
  );
}

type StreamProps = {
  title: ReactNode;
  /** Replaces the default summary (the outcome, thinking and actions, duration once ended). */
  summary?: ReactNode;
  /** Shown after the summary: the pro view's model, usage and nudges. */
  meta?: ReactNode;
  /** Buttons beside the header (abort). */
  actions?: ReactNode;
  pro: boolean;
  size: StreamSize;
  testId?: string;
  /** Folds as soon as the attempt ends, even while watched (the knowledge research card once answered, 18 §2.1). */
  foldOnEnd?: boolean;
};

/**
 * An attempt's conversation stream in a box of fixed height (25 §3–§5): it scrolls inside, follows the newest content
 * until the user scrolls up, and folds to its header once the attempt has ended.
 */
export function ConversationStream({ attemptId, ...props }: { attemptId: string } & StreamProps) {
  const attempt = useQuery(attemptQuery(attemptId));
  const { pages, entries } = useTranscript(attemptTranscript(attemptId));
  if (attempt.isError) return <ErrorState error={attempt.error} onRetry={() => void attempt.refetch()} />;
  if (pages.isError && pages.data === undefined)
    return <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />;
  if (attempt.data === undefined || pages.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
  const more = pages.isFetchNextPageError ? (
    <ErrorState error={pages.error} onRetry={() => void pages.fetchNextPage()} />
  ) : (
    pages.hasNextPage && <p className="hint">{COMMON_COPY.loading}</p>
  );
  return <Box attempt={attempt.data} entries={entries} more={more} {...props} />;
}
