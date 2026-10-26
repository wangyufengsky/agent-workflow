import { Link, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { CommandPalette } from '../../components/command-palette.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { NAV_COPY } from '../../copy/nav.ts';
import { AssistantPanel } from '../../features/assistant/assistant-panel.tsx';
import { useAssistantRequests } from '../../features/assistant/assistant-requests.ts';
import { useAssistantHandoff } from '../../features/assistant/handoff.ts';
import { PreviewBinding } from '../../features/assistant/preview-binding.tsx';
import { DEFAULT_START_WORKFLOW } from '../../features/home/workflow-icon.ts';
import { WebsitePrompts } from '../../features/preview/website-prompt.tsx';
import { useSettings } from '../../features/settings/settings.queries.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { NAV_ITEMS, navItemsFor } from '../navigation.ts';
import { ROUTES } from '../routes.ts';
import { CredentialsBanner } from './credentials-banner.tsx';
import { InboxButton } from './inbox-button.tsx';
import { NavLink } from './nav-link.tsx';
import { RuntimeChip } from './runtime-chip.tsx';
import { usePaletteItems } from './use-palette-items.ts';

/** The assistant button and ⌘J: the panel, or on the home page its own input, which holds the conversation (D112). */
function toggleAssistant(onHome: boolean) {
  if (onHome) useUiStore.getState().focusHomeInput();
  else useUiStore.setState((s) => ({ assistantOpen: !s.assistantOpen }));
}

/** 「开始任务」: the home input in that mode with the default workflow (28 §2.2). */
const START_TASK = { to: ROUTES.home, search: { workflow: DEFAULT_START_WORKFLOW } } as const;

/** Global shortcuts (14 §2): ⌘K palette, ⌘J assistant, ⌘N start a task, ⌘, settings. */
function useShortcuts() {
  const navigate = useNavigate();
  const router = useRouter();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const unsubscribe = window.aw?.browser.onShortcut((key) => {
      if (key === 'k') setPaletteOpen(true);
      else toggleAssistant(router.state.location.pathname === ROUTES.home);
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const actions: Record<string, () => void> = {
        k: () => setPaletteOpen(true),
        j: () => toggleAssistant(router.state.location.pathname === ROUTES.home),
        n: () => {
          void navigate(START_TASK);
          useUiStore.getState().focusHomeInput();
        },
        ',': () => void navigate({ to: ROUTES.settings }),
      };
      const action = actions[e.key.toLowerCase()];
      if (action === undefined) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribe?.();
    };
  }, [navigate, router, setPaletteOpen]);
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
  const onHome = useRouterState({ select: (s) => s.location.pathname === ROUTES.home });
  const assistantOpen = useUiStore((s) => s.assistantOpen) && !onHome;
  useShortcuts();
  useAssistantRequests();
  useAssistantHandoff();

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
        <Link {...START_TASK} className="nav-cta" onClick={() => useUiStore.getState().focusHomeInput()}>
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
          <IconButton
            icon="sparkle"
            label={assistantOpen ? ASSISTANT_COPY.close : ASSISTANT_COPY.open}
            aria-pressed={assistantOpen}
            onClick={() => toggleAssistant(onHome)}
          />
        </header>
        <CredentialsBanner />
        <main className="content">
          <PreviewBinding />
          <Outlet />
        </main>
      </div>
      {/* Floats over the page and plays its own open and close (D84), so it stays mounted. */}
      <AssistantPanel />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
      <WebsitePrompts />
    </div>
  );
}
