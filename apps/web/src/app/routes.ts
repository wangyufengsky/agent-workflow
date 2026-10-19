/** Route paths (14 §1); TanStack Router uses `$param`. */
export const ROUTES = {
  onboarding: '/onboarding',
  home: '/',
  tasks: '/tasks',
  inbox: '/inbox',
  projects: '/projects',
  project: '/projects/$projectId',
  settings: '/settings',
  git: '/git',
  workflows: '/workflows',
  roles: '/roles',
  databases: '/databases',
  tools: '/tools',
  runtime: '/runtime',
  /** Development-only component gallery for the four-theme screenshot review (M1-12). */
  devComponents: '/dev/components',
} as const;
export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** Route ids for `getRouteApi`: pages inside the sidebar layout live under the pathless `_shell` route. */
export const ROUTE_IDS = {
  projects: '/_shell/projects',
  project: '/_shell/projects/$projectId',
} as const;
