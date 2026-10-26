import { InboxStatus, InitiativeStatus, TaskDisplayGroup, type TaskSummaryDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { ModelSlotsLine } from '../attempts/model-slots.tsx';
import { batchesQuery } from '../batches/batches.queries.ts';
import { TemplateText } from '../batches/template-text.tsx';
import { inboxQuery } from '../inbox/inbox.queries.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { initiativesQuery } from '../initiatives/initiatives.queries.ts';
import { TaskRow } from '../tasks/task-row.tsx';
import { tasksQuery } from '../tasks/tasks.queries.ts';
import styles from './home.module.css';

/** How many open items the home page lists (14 §3.2); the rest are under「查看全部」. */
const ATTENTION_SHOWN = 3;

/**
 * Task sections below the open items (14 §3.2, 38 C3): in progress, then waiting to be merged; finished tasks are on
 * the task page. Tasks waiting for the user (a question, a plan, a failure) are not repeated here: their items above
 * say what to do.
 */
const SECTIONS: { title: string; groups: TaskDisplayGroup[] }[] = [
  {
    title: C.inProgress,
    groups: [TaskDisplayGroup.Preparing, TaskDisplayGroup.Running, TaskDisplayGroup.Paused, TaskDisplayGroup.Merging],
  },
  { title: C.toMerge, groups: [TaskDisplayGroup.Review] },
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
    tasks: tasks.filter((t) => section.groups.includes(t.displayGroup)),
  }));
  return { attention, batches, initiatives, sections };
}

/** An unfinished initiative or batch on one line of「进行中」(38 C3): its own page lists its tasks. */
function GroupRow({ title, meta, done, total, ...link }: GroupRowProps) {
  return (
    <Link {...link} className={`list-row ${styles.groupRow}`} data-testid="work-group-row">
      <span className={`ellipsis ${styles.groupTitle}`}>{title}</span>
      <span className="hint ellipsis grow">{meta}</span>
      <span className={styles.groupBar} aria-hidden="true">
        <span style={{ inlineSize: `${(100 * done) / total}%` }} />
      </span>
    </Link>
  );
}
type GroupRowProps = { title: React.ReactNode; meta: string; done: number; total: number } & (
  | { to: typeof ROUTES.initiative; params: { initiativeId: string } }
  | { to: typeof ROUTES.batch; params: { batchId: string } }
);

function TaskSection({
  title,
  tasks,
  children,
}: {
  title: string;
  tasks: TaskSummaryDTO[];
  children?: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="card list list-sep">
        {children}
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

/**
 * Below the idle home page, at most three sections (38 C3, C6): what needs the user; what is in progress — unfinished
 * initiatives and batches one line each, then tasks; and what waits to be merged.
 */
export function WorkOverview() {
  const { attention, batches, initiatives, sections } = useWork();
  const [inProgress, toMerge] = sections;
  const groups = initiatives.length + batches.length;
  return (
    <>
      <ModelSlotsLine />
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
      {inProgress !== undefined && inProgress.tasks.length + groups > 0 && (
        <TaskSection {...inProgress}>
          {initiatives.map((i) => (
            <GroupRow
              key={i.id}
              to={ROUTES.initiative}
              params={{ initiativeId: i.id }}
              title={i.title}
              meta={`${INITIATIVES_COPY.title} · ${INITIATIVES_COPY.progress(i.doneCount, i.itemCount)}`}
              done={i.doneCount}
              total={i.itemCount}
            />
          ))}
          {batches.map((b) => (
            <GroupRow
              key={b.id}
              to={ROUTES.batch}
              params={{ batchId: b.id }}
              title={<TemplateText text={b.title} />}
              meta={`${BATCHES_COPY.inProgress} · ${BATCHES_COPY.progress(b.ended, b.total)}`}
              done={b.ended}
              total={b.total}
            />
          ))}
        </TaskSection>
      )}
      {toMerge !== undefined && toMerge.tasks.length > 0 && <TaskSection {...toMerge} />}
      {attention.length === 0 && groups === 0 && sections.every((section) => section.tasks.length === 0) && (
        <p className="hint">{C.noneInProgress}</p>
      )}
    </>
  );
}
