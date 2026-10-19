import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { useServerEvents } from '../api/server-events.ts';
import { ErrorState } from '../components/error-state.tsx';
import { ToastHost } from '../components/toast.tsx';
import { ComponentGalleryPage } from '../features/dev/component-gallery.page.tsx';
import { HomePage } from '../features/home/home.page.tsx';
import { OnboardingPage } from '../features/onboarding/onboarding.page.tsx';
import { ComingSoonPage } from '../features/pro/coming-soon.page.tsx';
import { ProOnly } from '../features/pro/pro-only.tsx';
import { ProjectDetailPage } from '../features/projects/project-detail.page.tsx';
import { ProjectsPage } from '../features/projects/projects.page.tsx';
import { projectsQuery } from '../features/projects/projects.queries.ts';
import { SettingsPage } from '../features/settings/settings.page.tsx';
import { settingsQuery, useSettings } from '../features/settings/settings.queries.ts';
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

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.onboarding,
  component: OnboardingPage,
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
const proPage = <P extends string>(path: P, icon: Parameters<typeof ComingSoonPage>[0]['icon']) =>
  page(path, () => (
    <ProOnly>
      <ComingSoonPage icon={icon} />
    </ProOnly>
  ));

const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.projects,
  // `?add=true` opens the add-project dialog (command palette「添加项目」).
  validateSearch: z.object({ add: z.boolean().optional() }),
  component: ProjectsPage,
});
const projectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: ROUTES.project,
  component: ProjectDetailPage,
});

const routeTree = rootRoute.addChildren([
  onboardingRoute,
  shellRoute.addChildren([
    page(ROUTES.home, HomePage),
    page(ROUTES.tasks, () => <ComingSoonPage icon="list" />),
    page(ROUTES.inbox, () => <ComingSoonPage icon="inbox" />),
    projectsRoute,
    projectRoute,
    page(ROUTES.settings, SettingsPage),
    proPage(ROUTES.git, 'git'),
    proPage(ROUTES.workflows, 'flow'),
    proPage(ROUTES.roles, 'users'),
    proPage(ROUTES.databases, 'db'),
    proPage(ROUTES.tools, 'tool'),
    proPage(ROUTES.runtime, 'server'),
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
