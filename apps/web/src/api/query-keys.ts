/** TanStack Query keys: the only cache of server data in the renderer (06 §4). */
export const queryKeys = {
  settings: ['settings'],
  environment: ['system', 'environment'],
  projects: ['projects'],
  project: (id: string) => ['projects', id],
  paletteOperations: ['operations', 'palette'],
} as const;
