import { UiMode } from '@aw/shared';
import type { IconName } from '../components/icon.tsx';
import { NAV_COPY } from '../copy/nav.ts';
import { ROUTES, type RoutePath } from './routes.ts';

export type NavItem = {
  id: string;
  route: RoutePath;
  label: string;
  icon: IconName;
  /** Interface modes in which the item appears (D15: simple shows 5 items, pro adds the rest). */
  visibleIn: readonly UiMode[];
  group?: 'pro';
  position?: 'bottom';
  /** A live number next to the label: the open「需要你处理」items. */
  badge?: 'inboxOpen';
};

const BOTH = [UiMode.Simple, UiMode.Pro] as const;
const PRO = [UiMode.Pro] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', route: ROUTES.home, label: NAV_COPY.home, icon: 'home', visibleIn: BOTH },
  { id: 'tasks', route: ROUTES.tasks, label: NAV_COPY.tasks, icon: 'list', visibleIn: BOTH, badge: 'inboxOpen' },
  { id: 'projects', route: ROUTES.projects, label: NAV_COPY.projects, icon: 'folder', visibleIn: BOTH },
  { id: 'knowledge', route: ROUTES.knowledge, label: NAV_COPY.knowledge, icon: 'book', visibleIn: BOTH },
  { id: 'ppt', route: ROUTES.ppt, label: NAV_COPY.ppt, icon: 'slides', visibleIn: BOTH },
  { id: 'insights', route: ROUTES.insights, label: NAV_COPY.insights, icon: 'chart', visibleIn: BOTH },
  { id: 'team', route: ROUTES.teamIndex, label: NAV_COPY.team, icon: 'team', visibleIn: BOTH },
  { id: 'git', route: ROUTES.git, label: NAV_COPY.git, icon: 'git', visibleIn: PRO, group: 'pro' },
  { id: 'workflows', route: ROUTES.workflows, label: NAV_COPY.workflows, icon: 'flow', visibleIn: PRO, group: 'pro' },
  { id: 'roles', route: ROUTES.roles, label: NAV_COPY.roles, icon: 'users', visibleIn: PRO, group: 'pro' },
  { id: 'databases', route: ROUTES.databases, label: NAV_COPY.databases, icon: 'db', visibleIn: PRO, group: 'pro' },
  { id: 'tools', route: ROUTES.tools, label: NAV_COPY.tools, icon: 'tool', visibleIn: PRO, group: 'pro' },
  { id: 'runtime', route: ROUTES.runtime, label: NAV_COPY.runtime, icon: 'server', visibleIn: PRO, group: 'pro' },
  {
    id: 'settings',
    route: ROUTES.settings,
    label: NAV_COPY.settings,
    icon: 'settings',
    visibleIn: BOTH,
    position: 'bottom',
  },
];

export function navItemsFor(mode: UiMode): NavItem[] {
  return NAV_ITEMS.filter((item) => item.visibleIn.includes(mode));
}
