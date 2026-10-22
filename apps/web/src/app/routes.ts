/** Route paths (14 §1); TanStack Router uses `$param`. */
export const ROUTES = {
  /** First run only: without any project every shell page leads here (14 §3.1). */
  onboarding: '/onboarding',
  /** The same environment checks inside the shell (14 §3.1a). */
  environment: '/environment',
  home: '/',
  tasks: '/tasks',
  task: '/tasks/$taskId',
  node: '/tasks/$taskId/nodes/$nodeId',
  /** Batches of tasks (20): the list, a new batch, one batch. */
  batches: '/batches',
  batchNew: '/batches/new',
  batch: '/batches/$batchId',
  /** Scheduled tasks (22): the list, a new one, one schedule, changing it. */
  schedules: '/schedules',
  scheduleNew: '/schedules/new',
  schedule: '/schedules/$scheduleId',
  scheduleEdit: '/schedules/$scheduleId/edit',
  inbox: '/inbox',
  projects: '/projects',
  project: '/projects/$projectId',
  knowledge: '/knowledge',
  knowledgeConversation: '/knowledge/$conversationId',
  knowledgeHistory: '/knowledge/history',
  insights: '/insights',
  /** PPT (23 §2.1): the list, a new PPT, one PPT's workspace, its full-screen show and its print view. */
  ppt: '/ppt',
  pptNew: '/ppt/new',
  pptDeck: '/ppt/$deckId',
  pptPlay: '/ppt/$deckId/play',
  pptPrint: '/ppt/$deckId/print',
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
  scheduleNew: '/_shell/schedules/new',
  schedule: '/_shell/schedules/$scheduleId',
  scheduleEdit: '/_shell/schedules/$scheduleId/edit',
  projects: '/_shell/projects',
  project: '/_shell/projects/$projectId',
  runtime: '/_shell/runtime',
  gitProject: '/_shell/git/$projectId',
  knowledge: '/_shell/knowledge',
  knowledgeConversation: '/_shell/knowledge/$conversationId',
  knowledgeHistory: '/_shell/knowledge/history',
  insights: '/_shell/insights',
  ppt: '/_shell/ppt',
  pptNew: '/_shell/ppt/new',
  pptDeck: '/_shell/ppt/$deckId',
  pptPlay: '/ppt/$deckId/play',
  pptPrint: '/ppt/$deckId/print',
} as const;
