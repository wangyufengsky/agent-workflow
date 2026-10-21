import { EntityKind } from '@aw/shared';
import type { useNavigate } from '@tanstack/react-router';
import type { IconName } from '../components/icon.tsx';
import { ROUTES } from './routes.ts';

type Navigate = ReturnType<typeof useNavigate>;

/** How an object's page is opened, and the icon it is shown with. */
export type EntityRoute = { icon: IconName; open(navigate: Navigate, id: string): Promise<void> };

/**
 * The page of each object an operation can produce (D66), defined only here. Null: the object has no page yet
 * (knowledge base conversations arrive with the knowledge base).
 */
export const ENTITY_ROUTES = {
  [EntityKind.Task]: { icon: 'list', open: (navigate, id) => navigate({ to: ROUTES.task, params: { taskId: id } }) },
  [EntityKind.Project]: {
    icon: 'folder',
    open: (navigate, id) => navigate({ to: ROUTES.project, params: { projectId: id } }),
  },
  [EntityKind.Workflow]: { icon: 'flow', open: (navigate, key) => navigate({ to: ROUTES.workflow, params: { key } }) },
  [EntityKind.Role]: { icon: 'users', open: (navigate) => navigate({ to: ROUTES.roles }) },
  [EntityKind.DbConnection]: { icon: 'db', open: (navigate) => navigate({ to: ROUTES.databases }) },
  [EntityKind.KnowledgeConversation]: null,
} as const satisfies Record<EntityKind, EntityRoute | null>;
