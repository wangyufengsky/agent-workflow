import { InboxStatus, TaskDisplayGroup, type TaskSummaryDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { HOME_COPY } from '../../copy/home.ts';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { HomeAssistantEntry } from '../assistant/home-assistant-entry.tsx';
import { inboxQuery } from '../inbox/inbox.queries.ts';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { projectsQuery } from '../projects/projects.queries.ts';
import { TaskCard } from '../tasks/task-card.tsx';
import { tasksQuery } from '../tasks/tasks.queries.ts';
import { StartTaskForm } from './start-task-form.tsx';

/** How many open items and finished tasks the home page lists (14 §3.2). */
const ATTENTION_SHOWN = 3;
const RECENT_SHOWN = 5;

const route = getRouteApi(ROUTE_IDS.home);

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

function TaskSection({ title, tasks }: { title: string; tasks: TaskSummaryDTO[] }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="grid-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

/** Home (14 §3.2): start a task in one step, then what needs you, what runs and what finished. */
export function HomePage() {
  const projects = useQuery(projectsQuery).data ?? [];
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const projectId = projects.some((p) => p.id === search.projectId) ? search.projectId : projects[0]?.id;
  const tasks = useQuery(tasksQuery()).data ?? [];
  const attention = useQuery(inboxQuery({ status: InboxStatus.Open })).data ?? [];
  const sections = SECTIONS.map((section) => ({
    title: section.title,
    tasks: tasks.filter((t) => section.groups.includes(t.displayGroup)).slice(0, section.limit),
  }));

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="title grow">{HOME_COPY.title}</h1>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon="folder"
          title={C.noProjectTitle}
          body={C.noProjectBody}
          action={
            <Link to={ROUTES.projects} search={{ add: true }} className="btn primary">
              {C.addProject}
            </Link>
          }
        />
      ) : (
        <StartTaskForm
          // A new prefill in the address (the assistant's open_form, the report card) starts the form over.
          key={`${search.workflow}|${search.requirement}`}
          projects={projects}
          projectId={projectId ?? ''}
          initialWorkflowKey={search.workflow}
          initialRequirement={search.requirement}
          onProjectChange={(id) => void navigate({ search: { projectId: id }, replace: true })}
        />
      )}
      <HomeAssistantEntry />
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
      {sections.map((section) =>
        section.tasks.length === 0 ? null : <TaskSection key={section.title} {...section} />,
      )}
      {attention.length === 0 && sections.every((section) => section.tasks.length === 0) && (
        <p className="hint">{C.noneInProgress}</p>
      )}
    </div>
  );
}
