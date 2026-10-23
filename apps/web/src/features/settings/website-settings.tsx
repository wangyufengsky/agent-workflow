import {
  clearSiteLoginOp,
  closeUserTabOp,
  listSiteLoginsOp,
  openLoginTabOp,
  type Settings,
  SiteAccess,
  type SiteRule,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { WEBSITES_COPY as C } from '../../copy/browser.ts';
import { Segmented } from './setting-inputs.tsx';
import styles from './websites.module.css';

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** The website rules in order (29 §5.4), edited here and saved together. */
function SiteRules({ rules, set }: { rules: readonly SiteRule[]; set: (patch: Partial<Settings>) => void }) {
  const [draft, setDraft] = useState<SiteRule[]>([...rules]);
  const change = (index: number, rule: Partial<SiteRule>) =>
    setDraft(draft.map((r, i) => (i === index ? { ...r, ...rule } : r)));
  const save = () => {
    set({ 'browser.sites': draft.map((r) => ({ ...r, pattern: r.pattern.trim() })).filter((r) => r.pattern !== '') });
    toast(C.saved);
  };
  return (
    <div className="field">
      <p className={`hint ${styles.lede}`}>{C.lede}</p>
      {draft.length === 0 ? (
        <p className="hint">{C.none}</p>
      ) : (
        <ol className={styles.rules} aria-label={C.section}>
          {draft.map((rule, i) => (
            // Rules have no identity of their own: their place in the order is what they are.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            <li key={i} className={styles.rule}>
              <input
                className="input mono"
                aria-label={C.pattern}
                placeholder={C.patternPlaceholder}
                value={rule.pattern}
                onChange={(e) => change(i, { pattern: e.target.value })}
              />
              <Segmented
                label={C.access}
                value={rule.access}
                options={[SiteAccess.Read, SiteAccess.Interact].map((a) => ({ value: a, label: C.accessLabel[a] }))}
                onChange={(access) => change(i, { access })}
              />
              <IconButton
                icon="arrow-up"
                label={C.moveUp}
                disabled={i === 0}
                onClick={() => setDraft(move(draft, i, i - 1))}
              />
              <IconButton
                icon="arrow-down"
                label={C.moveDown}
                disabled={i === draft.length - 1}
                onClick={() => setDraft(move(draft, i, i + 1))}
              />
              <IconButton icon="trash" label={C.remove} onClick={() => setDraft(draft.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ol>
      )}
      <div className={styles.actions}>
        <Button icon="plus" onClick={() => setDraft([...draft, { pattern: '', access: SiteAccess.Read }])}>
          {C.add}
        </Button>
        <Button variant="primary" onClick={save}>
          {C.save}
        </Button>
      </div>
    </div>
  );
}

/** Keeps the user's tab over `area` while it is shown: its place follows layout changes and scrolling. */
function usePlacedTab(tabId: string | null, area: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const bridge = window.aw;
    const element = area.current;
    if (tabId === null || bridge === undefined || element === null) return;
    const place = () => {
      const r = element.getBoundingClientRect();
      bridge.browser.place(tabId, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      bridge.browser.place(tabId, null);
    };
  }, [tabId, area]);
}

/** Logging in to websites for the AI, in a real tab of the window, and logging out (29 §8.6). */
function SiteLogins() {
  const queryClient = useQueryClient();
  const logins = useQuery({ queryKey: queryKeys.siteLogins, queryFn: () => callOperation(listSiteLoginsOp, {}) });
  const [url, setUrl] = useState('');
  const [tabId, setTabId] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  usePlacedTab(tabId, area);
  const open = useMutation({
    mutationFn: () => callOperation(openLoginTabOp, { url: url.trim() }),
    onSuccess: (tab) => setTabId(tab.tabId),
  });
  const done = useMutation({
    mutationFn: (id: string) => callOperation(closeUserTabOp, { tabId: id }),
    onSuccess: () => {
      setTabId(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.siteLogins });
    },
  });
  const logout = useMutation({
    mutationFn: (host: string) => callOperation(clearSiteLoginOp, { host }),
    onSuccess: (result, host) => {
      queryClient.setQueryData(queryKeys.siteLogins, result);
      toast(C.loggedOut(host));
    },
  });
  const desktop = window.aw !== undefined;

  return (
    <div className="field">
      <span className="label">{C.login}</span>
      <p className="hint">{C.loginLede}</p>
      <div className="row">
        <input
          className="input mono grow"
          aria-label={C.loginUrl}
          placeholder="https://wiki.corp.example.com"
          value={url}
          disabled={tabId !== null}
          onChange={(e) => setUrl(e.target.value)}
        />
        {tabId === null ? (
          <Button pending={open.isPending} disabled={!desktop || url.trim() === ''} onClick={() => open.mutate()}>
            {C.loginOpen}
          </Button>
        ) : (
          <Button variant="primary" pending={done.isPending} onClick={() => done.mutate(tabId)}>
            {C.loginDone}
          </Button>
        )}
      </div>
      {!desktop && <p className="hint">{C.loginDesktopOnly}</p>}
      {open.isError && <ErrorState error={open.error} />}
      {tabId !== null && <div ref={area} className={styles.loginArea} />}
      <span className="label">{C.logins}</span>
      {logins.isError && <ErrorState error={logins.error} onRetry={() => void logins.refetch()} />}
      {logins.data?.hosts.length === 0 && <p className="hint">{C.loginsNone}</p>}
      {logins.data !== undefined && logins.data.hosts.length > 0 && (
        <ul className={styles.logins} aria-label={C.logins}>
          {logins.data.hosts.map((host) => (
            <li key={host}>
              <span className="grow mono">{host}</span>
              <Button
                size="sm"
                variant="ghost"
                pending={logout.isPending && logout.variables === host}
                onClick={() => logout.mutate(host)}
              >
                {C.logout}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The「网站」group of the settings (29 §8.6), shown in simple mode too. */
export function WebsiteSettings({ settings, set }: { settings: Settings; set: (patch: Partial<Settings>) => void }) {
  return (
    <Panel title={C.section}>
      {/* Keyed by the saved rules so the editor resets to them after saving. */}
      <SiteRules key={JSON.stringify(settings['browser.sites'])} rules={settings['browser.sites']} set={set} />
      <div className="divider" />
      <SiteLogins />
    </Panel>
  );
}
