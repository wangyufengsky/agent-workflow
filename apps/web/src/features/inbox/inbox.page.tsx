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

/** Open items grouped by task (14 §3.6). */
export function InboxPage() {
  const pages = useInfiniteQuery(inboxPagesQuery({ status: InboxStatus.Open }));
  const items = pages.data?.pages.flatMap((page) => page.items);
  const tasks = useQuery(tasksQuery());
  const groups = Map.groupBy(items ?? [], (item: InboxItemDTO) => item.taskId ?? '');
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      {pages.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {pages.isError && <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />}
      {items?.length === 0 && <EmptyState icon="inbox" title={C.empty} body={C.emptyBody} />}
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
      {pages.hasNextPage && (
        <div className="row">
          <Button pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {COMMON_COPY.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}
