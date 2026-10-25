/** TanStack Query keys: the only cache of server data in the renderer (06 §4). */
export const queryKeys = {
  settings: ['settings'],
  externalMcp: ['assistant', 'external-mcp'],
  environment: ['system', 'environment'],
  projects: ['projects'],
  project: (id: string) => ['projects', id],
  gitInitPreview: (repoPath: string) => ['projects', 'git-init-preview', repoPath],
  paletteOperations: ['operations', 'palette'],
  runtime: ['system', 'runtime'],
  modelSlots: ['system', 'model-slots'],
  health: ['system', 'health'],
  /** Every attempt key, details and their streams alike; `attempt` is the one two-part key under it. */
  attemptsAll: ['attempts'],
  attempt: (id: string) => ['attempts', id],
  /** An attachment's original never changes (30 §3.1). */
  attachment: (id: string) => ['attachments', id],
  attachmentContent: (id: string) => ['attachments', id, 'content'],
  transcript: (id: string) => ['attempts', id, 'transcript'],
  transcriptLive: (id: string) => ['attempts', id, 'transcript-live'],
  workflows: ['workflows'],
  workflow: (id: string) => ['workflows', id],
  workflowVersions: (key: string) => ['workflows', 'versions', key],
  roles: ['roles'],
  dbConnections: ['db-connections'],
  hostingAccounts: ['hosting-accounts'],
  dbSchema: (id: string) => ['db-connections', id, 'schema'],
  mcpTools: ['mcp', 'tools'],
  runtimeLogs: (tail: number) => ['system', 'runtime', 'logs', tail],
  storage: ['system', 'storage'],
  /** Every task list (all filters) shares this prefix. */
  taskLists: ['tasks', 'list'],
  tasks: (filter: Record<string, string | undefined>) => ['tasks', 'list', filter],
  /** All pages of a filtered list (the tasks page); under the same prefix, so task events refresh it. */
  taskPages: (filter: Record<string, string | undefined>) => ['tasks', 'list', 'pages', filter],
  /** Batches are under the task lists' prefix: their progress is their tasks', so task events refresh them (20 §4). */
  batches: (filter: Record<string, string | undefined>) => ['tasks', 'list', 'batches', filter],
  batch: (id: string) => ['tasks', 'list', 'batch', id],
  /** Initiatives too: their work packages' states are their tasks' (34 §6). */
  initiativeLists: ['tasks', 'list', 'initiatives'],
  initiatives: (filter: Record<string, string | undefined>) => ['tasks', 'list', 'initiatives', filter],
  initiative: (id: string) => ['tasks', 'list', 'initiative', id],
  initiativeTemplates: ['initiative-templates'],
  /** Schedules too: the state of the task a schedule started is part of it (22 §9). */
  scheduleLists: ['tasks', 'list', 'schedules'],
  schedules: (filter: Record<string, string | undefined>) => ['tasks', 'list', 'schedules', filter],
  schedule: (id: string) => ['tasks', 'list', 'schedule', id],
  task: (id: string) => ['tasks', 'detail', id],
  /** The task's acceptance checklist (31); it changes with the task, so task events refresh it. */
  taskRequirements: (id: string) => ['tasks', 'detail', id, 'requirements'],
  preview: (taskId: string) => ['tasks', 'detail', taskId, 'preview'],
  /** Under the task detail: a step's new page check result is a new session (29 §8.1). */
  previewSessions: (taskId: string) => ['tasks', 'detail', taskId, 'preview', 'sessions'],
  browserFrames: (attemptId: string) => ['attempts', attemptId, 'browser-frames'],
  /** The user's preview tab: set from its opening and `browser.tab_updated`, never fetched. */
  userTab: (tabId: string) => ['browser', 'tabs', tabId],
  userTabLogs: (tabId: string) => ['browser', 'tabs', tabId, 'logs'],
  siteLogins: ['browser', 'site-logins'],
  /** Outside the task detail's prefix: read from the platform only when the user asks, never refreshed by events. */
  reviewComments: (id: string) => ['review-comments', id],
  node: (taskId: string, nodeId: string) => ['tasks', 'detail', taskId, 'nodes', nodeId],
  inbox: ['inbox'],
  inboxList: (filter: Record<string, string | boolean | undefined>) => ['inbox', 'list', filter],
  inboxPages: (filter: Record<string, string | boolean | undefined>) => ['inbox', 'list', 'pages', filter],
  inboxCount: ['inbox', 'count'],
  taskDiff: (id: string) => ['tasks', 'detail', id, 'diff'],
  taskDiffFile: (id: string, path: string) => ['tasks', 'detail', id, 'diff', path],
  nodeDiff: (taskId: string, nodeId: string) => ['tasks', 'detail', taskId, 'nodes', nodeId, 'diff'],
  nodeDiffFile: (taskId: string, nodeId: string, path: string) => [
    'tasks',
    'detail',
    taskId,
    'nodes',
    nodeId,
    'diff',
    path,
  ],
  /** Highlighted tokens of a diff: derived in the renderer, cached like server data. */
  syntax: (path: string, digest: string) => ['syntax', path, digest],
  assistantConversations: ['assistant', 'conversations'],
  assistantTranscript: (id: string) => ['assistant', id, 'transcript'],
  assistantTranscriptLive: (id: string) => ['assistant', id, 'transcript-live'],
  assistantConfirmations: (id: string) => ['assistant', id, 'confirmations'],
  assistantFiles: (id: string) => ['assistant', id, 'files'],
  /** Every knowledge query shares this prefix; `knowledge.updated` refreshes them all. */
  knowledge: ['knowledge'],
  knowledgeConversation: (id: string) => ['knowledge', 'conversation', id],
  knowledgePages: (filter: Record<string, string | undefined>) => ['knowledge', 'list', filter],
  knowledgeCitation: (turnId: string, index: number) => ['knowledge', 'citation', turnId, index],
  /** Every PPT query shares this prefix; `deck.updated` refreshes them all. */
  decks: ['decks'],
  deck: (id: string) => ['decks', 'detail', id],
  deckPages: (filter: Record<string, string | undefined>) => ['decks', 'list', filter],
  /** Every quality and usage query shares this prefix; task updates refresh them. */
  insightsAll: ['insights'],
  insights: (view: 'summary' | 'tasks', query: Record<string, string | undefined>) => ['insights', view, query],
  /** Every team query of a project shares this prefix; fetching the repository refreshes them. */
  team: (projectId: string) => ['team', projectId],
  teamResource: (projectId: string, resource: string, params: Record<string, string | undefined>) => [
    'team',
    projectId,
    resource,
    params,
  ],
  /** Reading the project's commits (33 §7.2): set from `team.scan_updated`, never fetched. */
  teamScan: (projectId: string) => ['team-scan', projectId],
  git: (projectId: string) => ['git', projectId],
  gitResource: (projectId: string, resource: string, params: Record<string, string | number | undefined>) => [
    'git',
    projectId,
    resource,
    params,
  ],
  /** One AI review of the Git workbench, read by id (assistant cards open it without the project). */
  gitReview: (reviewId: string) => ['gitReview', reviewId],
} as const;
