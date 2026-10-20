/** TanStack Query keys: the only cache of server data in the renderer (06 §4). */
export const queryKeys = {
  settings: ['settings'],
  environment: ['system', 'environment'],
  projects: ['projects'],
  project: (id: string) => ['projects', id],
  paletteOperations: ['operations', 'palette'],
  runtime: ['system', 'runtime'],
  attempt: (id: string) => ['attempts', id],
  transcript: (id: string) => ['attempts', id, 'transcript'],
  workflows: ['workflows'],
  roles: ['roles'],
  /** Every task list (all filters) shares this prefix. */
  taskLists: ['tasks', 'list'],
  tasks: (filter: Record<string, string | undefined>) => ['tasks', 'list', filter],
  task: (id: string) => ['tasks', 'detail', id],
  node: (taskId: string, nodeId: string) => ['tasks', 'detail', taskId, 'nodes', nodeId],
  inbox: ['inbox'],
  inboxList: (filter: Record<string, string | undefined>) => ['inbox', 'list', filter],
  inboxCount: ['inbox', 'count'],
} as const;
