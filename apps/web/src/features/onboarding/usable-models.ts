import type { ModelInfo } from '@aw/shared';

/**
 * The models a session can use where it runs (D162): the global configuration's everywhere, a project's own only in
 * that project. `projectId` null is no project: a global setting (default model, role models) applies to every
 * project, and a PPT without a project works in an empty directory.
 */
export const usableModels = (models: readonly ModelInfo[], projectId: string | null): ModelInfo[] =>
  models.filter((m) => m.projectIds.length === 0 || (projectId !== null && m.projectIds.includes(projectId)));
