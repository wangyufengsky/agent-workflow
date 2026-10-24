import { InboxStatus, InitiativeStatus, TaskDisplayGroup, type TaskSummaryDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { BatchCard } from '../batches/batch-card.tsx';
import { batchesQuery } from '../batches/batches.queries.ts';
import { inboxQuery } from '../inbox/inbox.queries.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { InitiativeCard } from '../initiatives/initiative-card.tsx';
import { initiativesQuery } from '../initiatives/initiatives.queries.ts';
import { TaskRow } from '../tasks/task-row.tsx';
import { tasksQuery } from '../tasks/tasks.queries.ts';

/** How many open items and finished tasks the home page lists (14 §3.2). */
const ATTENTION_SHOWN = 3;
const RECENT_SHOWN = 5;

/**
 * Task sections below the open items (14 §3.2), by display state. Tasks waiting for the user (a question, a plan, a
 * failure) are not repeated here: their items above say what to do.
 */
const SECTIONS: { title: string; groups: TaskDisplayGroup[]; limit?: number }[] = [
  {
    title: C.inProgress,
    groups: [TaskDisplayGroup.Preparing, TaskDisplayGroup.Running, TaskDisplayGroup.Paused, TaskDisplayGroup.Merging],
  },
  { title: C.toMerge, groups: [TaskDisplayGroup.Review] },
  { title: C.recent, groups: [TaskDisplayGroup.Completed], limit: RECENT_SHOWN },
];

/** What is going on, for the overview under the idle home page and the rail beside a conversation (28 §2.1). */
export function useWork() {
  const tasks = useQuery(tasksQuery()).data ?? [];
  // Results waiting to be merged are the「待合并」section, not something holding a task up (D119).
  const attention = useQuery(inboxQuery({ status: InboxStatus.Open, blocking: true })).data ?? [];
  // Batches whose tasks have not all ended (20 §4).
  const batches = (useQuery(batchesQuery()).data ?? []).filter((b) => b.ended < b.total);
  // Initiatives not finished yet (34 §6.2).
  const initiatives = (useQuery(initiativesQuery()).data ?? []).filter((i) => i.status !== InitiativeStatus.Done);
  const sections = SECTIONS.map((section) => ({
    title: section.title,
    tasks: tasks.filter((t) => section.groups.includes(t.displayGroup)).slice(0, section.limit),
  }));
  return { attention, batches, initiatives, sections };
}

function TaskSection({ title, tasks }: { title: string; tasks: TaskSummaryDTO[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="card list list-sep">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

/** Below the idle home page: what needs the user, then batches and tasks by state (14 §3.2). */
export function WorkOverview() {
  const { attention, batches, initiatives, sections } = useWork();
  return (
    <>
      {attention.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title grow">{C.attention(attention.length)}</h2>
            <Link to={ROUTES.inbox} className="btn ghost sm">
              {C.viewAll}
            </Link>
          </div>
          <div className="col">
            {attention.slice(0, ATTENTION_SHOWN).map((item) => (
              <InboxCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      {initiatives.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title grow">{INITIATIVES_COPY.inProgress}</h2>
            <Link to={ROUTES.initiatives} className="btn ghost sm">
              {INITIATIVES_COPY.viewAll}
            </Link>
          </div>
          <div className="grid-2">
            {initiatives.map((i) => (
              <InitiativeCard key={i.id} initiative={i} />
            ))}
          </div>
        </section>
      )}
      {batches.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title grow">{BATCHES_COPY.inProgress}</h2>
            <Link to={ROUTES.batches} className="btn ghost sm">
              {BATCHES_COPY.viewAll}
            </Link>
          </div>
          <div className="grid-2">
            {batches.map((b) => (
              <BatchCard key={b.id} batch={b} />
            ))}
          </div>
        </section>
      )}
      {sections.map((section) =>
        section.tasks.length === 0 ? null : <TaskSection key={section.title} {...section} />,
      )}
      {attention.length === 0 && sections.every((section) => section.tasks.length === 0) && (
        <p className="hint">{C.noneInProgress}</p>
      )}
    </>
  );
}
