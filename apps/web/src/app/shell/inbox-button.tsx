import { type InboxItemDTO, InboxStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { INBOX_COPY as C } from '../../copy/tasks.ts';
import { inboxCountQuery, inboxQuery } from '../../features/inbox/inbox.queries.ts';
import { InboxCard } from '../../features/inbox/inbox-card.tsx';
import { ROUTES } from '../routes.ts';

/**
 * Header button with the count of items holding something up; opens them in a side panel to handle them in place
 * (14 §2), with the results waiting to be merged after them (D119).
 */
export function InboxButton() {
  const [open, setOpen] = useState(false);
  const count = useQuery(inboxCountQuery).data ?? 0;
  const blocking = useQuery({ ...inboxQuery({ status: InboxStatus.Open, blocking: true }), enabled: open });
  const deliveries = useQuery({ ...inboxQuery({ status: InboxStatus.Open, blocking: false }), enabled: open });
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
        {blocking.data !== undefined && deliveries.data !== undefined && (
          <InboxGroups blocking={blocking.data} deliveries={deliveries.data} />
        )}
      </Drawer>
    </>
  );
}

function InboxGroups({ blocking, deliveries }: { blocking: InboxItemDTO[]; deliveries: InboxItemDTO[] }) {
  return (
    <div className="col">
      {blocking.length === 0 && <p className="hint">{deliveries.length === 0 ? C.empty : C.noneWaiting}</p>}
      {blocking.map((item) => (
        <InboxCard key={item.id} item={item} />
      ))}
      {deliveries.length > 0 && (
        <>
          <h3 className="sec-t">{C.toMerge}</h3>
          {deliveries.map((item) => (
            <InboxCard key={item.id} item={item} />
          ))}
        </>
      )}
    </div>
  );
}
