import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { CommandPalette } from '../../components/command-palette.tsx';
import { Icon } from '../../components/icon.tsx';
import { NAV_COPY } from '../../copy/nav.ts';
import { useSettings } from '../../features/settings/settings.queries.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { NAV_ITEMS, navItemsFor } from '../navigation.ts';
import { ROUTES } from '../routes.ts';
import { InboxButton } from './inbox-button.tsx';
import { NavLink } from './nav-link.tsx';
import { RuntimeChip } from './runtime-chip.tsx';
import { ThemeSwitch } from './theme-switch.tsx';
import { usePaletteItems } from './use-palette-items.ts';

/** Global shortcuts (14 §2): ⌘K palette, ⌘N start a task, ⌘, settings. ⌘J stays reserved for the v1.1 assistant. */
function useShortcuts() {
  const navigate = useNavigate();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const actions: Record<string, () => void> = {
        k: () => setPaletteOpen(true),
        n: () => void navigate({ to: ROUTES.home }),
        ',': () => void navigate({ to: ROUTES.settings }),
      };
      const action = actions[e.key.toLowerCase()];
      if (action === undefined) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, setPaletteOpen]);
}

/** Shell pages reached from the top bar rather than the sidebar. */
const PAGES_OUTSIDE_NAV = [{ route: ROUTES.inbox, label: NAV_COPY.inbox }];

function useCurrentTitle(): string {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const item = [...NAV_ITEMS, ...PAGES_OUTSIDE_NAV]
    .sort((a, b) => b.route.length - a.route.length)
    .find((i) => (i.route === ROUTES.home ? pathname === '/' : pathname.startsWith(i.route)));
  return item?.label ?? NAV_COPY.brand;
}

export function AppShell() {
  const mode = useSettings()['ui.mode'];
  const items = navItemsFor(mode);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const paletteItems = usePaletteItems();
  const title = useCurrentTitle();
  useShortcuts();

  return (
    <div className="app">
      <nav className="nav" aria-label={NAV_COPY.brand}>
        <div className="brand">
          <span className="brand-mark">
            <Icon name="logo" />
          </span>
          <span className="brand-text">
            <span className="brand-name">{NAV_COPY.brand}</span>
            <span className="brand-sub">{NAV_COPY.brandSub}</span>
          </span>
        </div>
        <Link to={ROUTES.home} className="nav-cta">
          <Icon name="plus" />
          {NAV_COPY.startTask}
        </Link>
        {items
          .filter((i) => i.group === undefined && i.position === undefined)
          .map((i) => (
            <NavLink key={i.id} item={i} />
          ))}
        {items.some((i) => i.group === 'pro') && <div className="nav-cap">{NAV_COPY.proGroup}</div>}
        {items
          .filter((i) => i.group === 'pro')
          .map((i) => (
            <NavLink key={i.id} item={i} />
          ))}
        <div className="nav-foot col">
          {items
            .filter((i) => i.position === 'bottom')
            .map((i) => (
              <NavLink key={i.id} item={i} />
            ))}
          <RuntimeChip />
        </div>
      </nav>
      <div className="main">
        <header className="header">
          <h1>{title}</h1>
          <span className="spacer" />
          <InboxButton />
          <ThemeSwitch />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
    </div>
  );
}
