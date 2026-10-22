import { type InboxItemDTO, InboxStatus } from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { INBOX_COPY as C } from '../../copy/tasks.ts';
import { tasksQuery } from '../tasks/tasks.queries.ts';
import { inboxPagesQuery } from './inbox.queries.ts';
import { InboxCard } from './inbox-card.tsx';

/**
 * Open items holding something up, grouped by task; then the results waiting to be merged (14 §3.6, D119). The server
 * filters each group, so each pages on its own.
 */
export function InboxPage() {
  const blocking = useInfiniteQuery(inboxPagesQuery({ status: InboxStatus.Open, blocking: true }));
  const deliveries = useInfiniteQuery(inboxPagesQuery({ status: InboxStatus.Open, blocking: false }));
  const waiting = blocking.data?.pages.flatMap((page) => page.items);
  const toMerge = deliveries.data?.pages.flatMap((page) => page.items);
  const tasks = useQuery(tasksQuery());
  const groups = Map.groupBy(waiting ?? [], (item: InboxItemDTO) => item.taskId ?? '');
  const empty = waiting?.length === 0 && toMerge?.length === 0;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      {(blocking.isPending || deliveries.isPending) && <p className="hint">{COMMON_COPY.loading}</p>}
      {blocking.isError && <ErrorState error={blocking.error} onRetry={() => void blocking.refetch()} />}
      {deliveries.isError && <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />}
      {empty && <EmptyState icon="inbox" title={C.empty} body={C.emptyBody} />}
      {waiting !== undefined && toMerge !== undefined && !empty && (
        <>
          <h2 className="sec-t" data-testid="inbox-waiting">
            {C.waiting}
          </h2>
          {waiting.length === 0 && <p className="hint">{C.noneWaiting}</p>}
        </>
      )}
      {[...groups].map(([taskId, group]) => {
        const task = tasks.data?.find((t) => t.id === taskId);
        return (
          <section key={taskId} className="section">
            {task !== undefined && (
              <div className="section-head">
                <Link to={ROUTES.task} params={{ taskId }} search={{}} className="section-title">
                  {C.inTask(task.key, task.title)}
                </Link>
              </div>
            )}
            <div className="col">
              {group.map((item) => (
                <InboxCard key={item.id} item={item} showTask={task === undefined} />
              ))}
            </div>
          </section>
        );
      })}
      <LoadMore pages={blocking} />
      {toMerge !== undefined && toMerge.length > 0 && (
        <section className="section" data-testid="inbox-to-merge">
          <div className="section-head">
            <h2 className="sec-t">{C.toMerge}</h2>
          </div>
          <div className="col">
            {toMerge.map((item) => (
              <InboxCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      <LoadMore pages={deliveries} />
    </div>
  );
}

function LoadMore({
  pages,
}: {
  pages: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => Promise<unknown> };
}) {
  if (!pages.hasNextPage) return null;
  return (
    <div className="row">
      <Button pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
        {COMMON_COPY.loadMore}
      </Button>
    </div>
  );
}
