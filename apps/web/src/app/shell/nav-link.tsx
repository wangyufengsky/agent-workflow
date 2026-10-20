import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Icon } from '../../components/icon.tsx';
import { inboxCountQuery } from '../../features/inbox/inbox.queries.ts';
import type { NavItem } from '../navigation.ts';
import { ROUTES } from '../routes.ts';

function InboxCount() {
  const count = useQuery(inboxCountQuery).data ?? 0;
  return count === 0 ? null : (
    <span className="count" data-testid="nav-inbox-count">
      {count}
    </span>
  );
}

export function NavLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.route}
      className="nav-item"
      activeOptions={{ exact: item.route === ROUTES.home }}
      activeProps={{ 'aria-current': 'page' }}
    >
      <Icon name={item.icon} />
      {item.label}
      {item.badge === 'inboxOpen' && <InboxCount />}
    </Link>
  );
}
