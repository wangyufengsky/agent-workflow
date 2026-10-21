/** Route paths (14 §1); TanStack Router uses `$param`. */
export const ROUTES = {
  onboarding: '/onboarding',
  home: '/',
  tasks: '/tasks',
  task: '/tasks/$taskId',
  node: '/tasks/$taskId/nodes/$nodeId',
  /** Batches of tasks (20): the list, a new batch, one batch. */
  batches: '/batches',
  batchNew: '/batches/new',
  batch: '/batches/$batchId',
  inbox: '/inbox',
  projects: '/projects',
  project: '/projects/$projectId',
  knowledge: '/knowledge',
  knowledgeConversation: '/knowledge/$conversationId',
  knowledgeHistory: '/knowledge/history',
  insights: '/insights',
  settings: '/settings',
  git: '/git',
  gitProject: '/git/$projectId',
  workflows: '/workflows',
  workflow: '/workflows/$key',
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
  home: '/_shell/',
  tasks: '/_shell/tasks',
  task: '/_shell/tasks/$taskId',
  node: '/_shell/tasks/$taskId/nodes/$nodeId',
  workflow: '/_shell/workflows/$key',
  batchNew: '/_shell/batches/new',
  batch: '/_shell/batches/$batchId',
  projects: '/_shell/projects',
  project: '/_shell/projects/$projectId',
  runtime: '/_shell/runtime',
  gitProject: '/_shell/git/$projectId',
  knowledge: '/_shell/knowledge',
  knowledgeConversation: '/_shell/knowledge/$conversationId',
  knowledgeHistory: '/_shell/knowledge/history',
  insights: '/_shell/insights',
} as const;
