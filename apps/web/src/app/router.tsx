import { taskDisplayGroupSchema } from '@aw/shared';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { useServerEvents } from '../api/server-events.ts';
import { ErrorState } from '../components/error-state.tsx';
import { ToastHost } from '../components/toast.tsx';
import { BatchPage } from '../features/batches/batch.page.tsx';
import { BatchesPage } from '../features/batches/batches.page.tsx';
import { NewBatchPage } from '../features/batches/new-batch.page.tsx';
import { DatabasesPage } from '../features/databases/databases.page.tsx';
import { ComponentGalleryPage } from '../features/dev/component-gallery.page.tsx';
import { GitConsolePage } from '../features/git/git-console.page.tsx';
import { GIT_TABS, GitProjectPage } from '../features/git/git-project.page.tsx';
import { HomePage } from '../features/home/home.page.tsx';
import { InboxPage } from '../features/inbox/inbox.page.tsx';
import { InsightsPage, insightsSearchSchema } from '../features/insights/insights.page.tsx';
import { KnowledgeConversationPage, KnowledgeWelcomePage } from '../features/knowledge/knowledge.page.tsx';
import { KnowledgeHistoryPage } from '../features/knowledge/knowledge-history.page.tsx';
import { NodePage } from '../features/node-detail/node.page.tsx';
import { EnvironmentPage, OnboardingPage } from '../features/onboarding/onboarding.page.tsx';
import { PptDeckPage } from '../features/ppt/ppt-deck.page.tsx';
import { PptListPage } from '../features/ppt/ppt-list.page.tsx';
import { PptNewPage } from '../features/ppt/ppt-new.page.tsx';
import { PptPlayPage } from '../features/ppt/ppt-play.page.tsx';
import { PptPrintPage } from '../features/ppt/ppt-print.page.tsx';
import { ProOnly } from '../features/pro/pro-only.tsx';
import { ProjectDetailPage } from '../features/projects/project-detail.page.tsx';
import { ProjectsPage } from '../features/projects/projects.page.tsx';
import { projectsQuery } from '../features/projects/projects.queries.ts';
import { RolesPage } from '../features/roles/roles.page.tsx';
import { RuntimePage } from '../features/runtime/runtime.page.tsx';
import { EditSchedulePage } from '../features/schedules/edit-schedule.page.tsx';
import { NewSchedulePage } from '../features/schedules/new-schedule.page.tsx';
import { SchedulePage } from '../features/schedules/schedule.page.tsx';
import { SchedulesPage } from '../features/schedules/schedules.page.tsx';
import { SettingsPage } from '../features/settings/settings.page.tsx';
import { settingsQuery, useSettings } from '../features/settings/settings.queries.ts';
import { TaskPage } from '../features/task-detail/task.page.tsx';
import { TasksPage } from '../features/tasks/tasks.page.tsx';
import { ToolsPage } from '../features/tools/tools.page.tsx';
import { WorkflowEditorPage } from '../features/workflows/workflow-editor.page.tsx';
import { WorkflowsPage } from '../features/workflows/workflows.page.tsx';
import { useAppliedTheme } from '../theme/use-applied-theme.ts';
import { ROUTES } from './routes.ts';
import { AppShell } from './shell/app-shell.tsx';

export type RouterContext = { queryClient: QueryClient };

function Root() {
  useAppliedTheme(useSettings()['ui.theme']);
  useServerEvents();
  return (
    <>
      <Outlet />
      <ToastHost />
    </>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // Theme and mode come from settings, so nothing renders before they are loaded.
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: Root,
  errorComponent: ({ error, reset }) => (
    <div className="page narrow">
      <ErrorState error={error} onRetry={reset} />
    </div>
  ),
});

/** First run only: once a project exists the checks live inside the shell (14 §3.1). */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.onboarding,
  component: OnboardingPage,
  beforeLoad: async ({ context }) => {
    const projects = await context.queryClient.ensureQueryData(projectsQuery);
    if (projects.length > 0) throw redirect({ to: ROUTES.environment });
  },
});

/** Everything with the sidebar; without any project the first run goes through onboarding (14 §3.1). */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_shell',
  component: AppShell,
  beforeLoad: async ({ context }) => {
    const projects = await context.queryClient.ensureQueryData(projectsQuery);
    if (projects.length === 0) throw redirect({ to: ROUTES.onboarding });
  },
});

const page = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => shellRoute, path, component });
/** A pro page (14 §1): in simple mode it explains itself and offers to switch. */
const proOnlyPage = <P extends string>(path: P, Component: () => React.ReactNode) =>
  page(path, () => (
    <ProOnly>
      <Component />
    </ProOnly>
  ));
const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.projects,
  // `?add=true` opens the add-project dialog (command palette「添加项目」).
  validateSearch: z.object({ add: z.boolean().optional() }),
  component: ProjectsPage,
});
const runtimeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.runtime,
  // `?attempt=<id>` shows a debug attempt started from this page (development builds, M2-09).
  validateSearch: z.object({ attempt: z.string().optional() }),
  component: () => (
    <ProOnly>
      <RuntimePage />
    </ProOnly>
  ),
});
const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.home,
  // The project to start a task in; kept in the URL so a reload or link keeps it. A workflow key and requirement
  // prefill the form (the report card's「据此修复」).
  validateSearch: z.object({
    projectId: z.string().optional(),
    workflow: z.string().optional(),
    requirement: z.string().optional(),
  }),
  component: HomePage,
});
const tasksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.tasks,
  validateSearch: z.object({ projectId: z.string().optional(), displayGroup: taskDisplayGroupSchema.optional() }),
  component: TasksPage,
});
const taskRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.task,
  // `?node=<id>` selects a step on the canvas; `open` shows its details drawer (14 §3.4); `details` shows the pro view
  // of this task in simple mode (D19).
  validateSearch: z.object({
    node: z.string().optional(),
    open: z.boolean().optional(),
    details: z.boolean().optional(),
  }),
  component: TaskPage,
});
const nodeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.node,
  // `?attempt=<id>` shows one attempt; the latest by default (M5-04).
  validateSearch: z.object({ attempt: z.string().optional() }),
  component: NodePage,
});
// Batches (20): a new batch keeps the project and workflow it was opened for (the home page's「批量」).
const batchNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.batchNew,
  validateSearch: z.object({ projectId: z.string().optional(), workflow: z.string().optional() }),
  component: NewBatchPage,
});
// Scheduled tasks (22): a new schedule keeps the project and workflow it was opened for (the home page's「定时」).
const scheduleNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.scheduleNew,
  validateSearch: z.object({ projectId: z.string().optional(), workflow: z.string().optional() }),
  component: NewSchedulePage,
});
const gitRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.git,
  component: () => (
    <ProOnly>
      <GitConsolePage />
    </ProOnly>
  ),
});
const gitProjectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.gitProject,
  // The open tab and what it shows: a ref's log or one commit, a directory or file of the tree.
  validateSearch: z.object({
    tab: z.enum(GIT_TABS).optional(),
    ref: z.string().optional(),
    sha: z.string().optional(),
    path: z.string().optional(),
    file: z.boolean().optional(),
  }),
  component: () => (
    <ProOnly>
      <GitProjectPage />
    </ProOnly>
  ),
});
// Knowledge Q&A (18 §2): the first screen keeps the chosen project in the address; a conversation keeps the open
// citation (`turn` + `cite`) and the pro view of simple mode (`details`); the history keeps its filters.
const knowledgeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.knowledge,
  validateSearch: z.object({ projectId: z.string().optional() }),
  component: KnowledgeWelcomePage,
});
const knowledgeConversationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.knowledgeConversation,
  validateSearch: z.object({
    turn: z.string().optional(),
    cite: z.number().int().min(1).optional(),
    details: z.boolean().optional(),
  }),
  component: KnowledgeConversationPage,
});
const knowledgeHistoryRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.knowledgeHistory,
  validateSearch: z.object({ q: z.string().optional(), projectId: z.string().optional() }),
  component: KnowledgeHistoryPage,
});
// Quality and usage (19 §3): the period and the metric drilled into stay in the address.
const insightsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.insights,
  validateSearch: insightsSearchSchema,
  component: InsightsPage,
});
// PPT (23 §2): a new PPT keeps the material it was opened with (「做成 PPT」); the workspace keeps the selected page
// and the pro view of simple mode. The show and the print view are full pages outside the sidebar.
const pptNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.pptNew,
  validateSearch: z.object({
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    knowledgeConversationId: z.string().optional(),
  }),
  component: PptNewPage,
});
const pptDeckRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.pptDeck,
  validateSearch: z.object({ slide: z.string().optional(), details: z.boolean().optional() }),
  component: PptDeckPage,
});
const pptPlayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.pptPlay,
  validateSearch: z.object({ slide: z.string().optional() }),
  component: PptPlayPage,
});
const pptPrintRoute = createRoute({ getParentRoute: () => rootRoute, path: ROUTES.pptPrint, component: PptPrintPage });
const projectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.project,
  component: ProjectDetailPage,
});

const routeTree = rootRoute.addChildren([
  onboardingRoute,
  pptPlayRoute,
  pptPrintRoute,
  shellRoute.addChildren([
    homeRoute,
    tasksRoute,
    taskRoute,
    nodeRoute,
    page(ROUTES.batches, BatchesPage),
    batchNewRoute,
    page(ROUTES.batch, BatchPage),
    page(ROUTES.schedules, SchedulesPage),
    scheduleNewRoute,
    page(ROUTES.schedule, SchedulePage),
    page(ROUTES.scheduleEdit, EditSchedulePage),
    page(ROUTES.inbox, InboxPage),
    projectsRoute,
    projectRoute,
    knowledgeRoute,
    knowledgeHistoryRoute,
    knowledgeConversationRoute,
    insightsRoute,
    page(ROUTES.ppt, PptListPage),
    pptNewRoute,
    pptDeckRoute,
    page(ROUTES.settings, SettingsPage),
    page(ROUTES.environment, EnvironmentPage),
    gitRoute,
    gitProjectRoute,
    proOnlyPage(ROUTES.workflows, WorkflowsPage),
    proOnlyPage(ROUTES.workflow, WorkflowEditorPage),
    proOnlyPage(ROUTES.roles, RolesPage),
    proOnlyPage(ROUTES.databases, DatabasesPage),
    proOnlyPage(ROUTES.tools, ToolsPage),
    runtimeRoute,
  ]),
  ...(import.meta.env.DEV
    ? [createRoute({ getParentRoute: () => rootRoute, path: ROUTES.devComponents, component: ComponentGalleryPage })]
    : []),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreloadStaleTime: 0 });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
