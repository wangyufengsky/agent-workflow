import { InboxStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { INBOX_COPY as C } from '../../copy/tasks.ts';
import { inboxCountQuery, inboxQuery } from '../../features/inbox/inbox.queries.ts';
import { InboxCard } from '../../features/inbox/inbox-card.tsx';
import { tasksQuery } from '../../features/tasks/tasks.queries.ts';
import { ROUTES } from '../routes.ts';

/** Header button with the open count; opens the items in a side panel to handle them in place (14 §2). */
export function InboxButton() {
  const [open, setOpen] = useState(false);
  const count = useQuery(inboxCountQuery).data ?? 0;
  const items = useQuery({ ...inboxQuery({ status: InboxStatus.Open }), enabled: open });
  const tasks = useQuery({ ...tasksQuery(), enabled: open });
  const label = (taskId: string | null) => {
    const task = tasks.data?.find((t) => t.id === taskId);
    return task === undefined ? undefined : C.inTask(task.key, task.title);
  };
  return (
    <>
      <Button variant={count > 0 ? 'brand' : 'ghost'} icon="inbox" onClick={() => setOpen(true)}>
        {C.open(count)}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={C.title}
        footer={
          <Link to={ROUTES.inbox} className="btn" onClick={() => setOpen(false)}>
            {C.viewAll}
          </Link>
        }
      >
        <div className="col">
          {items.data?.length === 0 && <p className="hint">{C.empty}</p>}
          {items.data?.map((item) => (
            <InboxCard key={item.id} item={item} taskLabel={label(item.taskId)} />
          ))}
        </div>
      </Drawer>
    </>
  );
}
