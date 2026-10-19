import { Link } from '@tanstack/react-router';
import { Icon } from '../../components/icon.tsx';
import type { NavItem } from '../navigation.ts';
import { ROUTES } from '../routes.ts';

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
    </Link>
  );
}
