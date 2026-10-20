import { InboxStatus, isTerminalState, TaskStatus, taskMachine } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { HOME_COPY } from '../../copy/home.ts';
import { HOME_TASK_COPY as C, INBOX_COPY } from '../../copy/tasks.ts';
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

/** Home (14 §3.2): start a task in one step, then what needs you, what runs and what finished. */
export function HomePage() {
  const projects = useQuery(projectsQuery).data ?? [];
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const projectId = projects.some((p) => p.id === search.projectId) ? search.projectId : projects[0]?.id;
  const tasks = useQuery(tasksQuery()).data ?? [];
  const attention = useQuery(inboxQuery({ status: InboxStatus.Open })).data ?? [];
  const inProgress = tasks.filter((t) => !isTerminalState(taskMachine, t.status));
  const recent = tasks.filter((t) => t.status === TaskStatus.Completed).slice(0, RECENT_SHOWN);
  const label = (taskId: string | null) => {
    const task = tasks.find((t) => t.id === taskId);
    return task === undefined ? undefined : INBOX_COPY.inTask(task.key, task.title);
  };

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
          projects={projects}
          projectId={projectId ?? ''}
          onProjectChange={(id) => void navigate({ search: { projectId: id }, replace: true })}
        />
      )}
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
              <InboxCard key={item.id} item={item} taskLabel={label(item.taskId)} />
            ))}
          </div>
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{C.inProgress}</h2>
        </div>
        {inProgress.length === 0 ? (
          <p className="hint">{C.noneInProgress}</p>
        ) : (
          <div className="grid-2">
            {inProgress.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        )}
      </section>
      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">{C.recent}</h2>
          </div>
          <div className="grid-2">
            {recent.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
