import {
  clearSiteLoginOp,
  closeUserTabOp,
  integratedAuthServerSchema,
  listSiteLoginsOp,
  openLoginTabOp,
  type Settings,
  SiteAccess,
  type SiteRule,
  siteRuleSchema,
  UiMode,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { WEBSITES_COPY as C } from '../../copy/browser.ts';
import { usePlacedTab } from '../preview/use-placed-tab.ts';
import { Segmented } from './setting-inputs.tsx';
import styles from './websites.module.css';

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** A rule as edited: its query paths as typed, comma-separated. */
type DraftRule = Omit<SiteRule, 'queryPaths'> & { queryPaths: string };
const splitList = (text: string) => text.split(/[\s,]+/).filter((s) => s !== '');

/** The website rules in order (29 §5.4), edited here and saved together. */
function SiteRules({ rules, set }: { rules: readonly SiteRule[]; set: (patch: Partial<Settings>) => void }) {
  const [draft, setDraft] = useState<DraftRule[]>(rules.map((r) => ({ ...r, queryPaths: r.queryPaths.join(', ') })));
  const [invalid, setInvalid] = useState(false);
  const change = (index: number, rule: Partial<DraftRule>) =>
    setDraft(draft.map((r, i) => (i === index ? { ...r, ...rule } : r)));
  const save = () => {
    const parsed = siteRuleSchema.array().safeParse(
      draft
        .map((r) => ({
          pattern: r.pattern.trim(),
          access: r.access,
          // Only a read-only website has query paths to let through.
          queryPaths: r.access === SiteAccess.Read ? splitList(r.queryPaths) : [],
        }))
        .filter((r) => r.pattern !== ''),
    );
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    set({ 'browser.sites': parsed.data });
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
              {rule.access === SiteAccess.Read && (
                <input
                  className={`input mono ${styles.queryPaths}`}
                  aria-label={C.queryPaths}
                  placeholder={C.queryPathsPlaceholder}
                  value={rule.queryPaths}
                  onChange={(e) => change(i, { queryPaths: e.target.value })}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="hint">{invalid ? C.rulesInvalid : C.queryPathsHint}</p>
      <div className={styles.actions}>
        <Button
          icon="plus"
          onClick={() => setDraft([...draft, { pattern: '', access: SiteAccess.Read, queryPaths: '' }])}
        >
          {C.add}
        </Button>
        <Button variant="primary" onClick={save}>
          {C.save}
        </Button>
      </div>
    </div>
  );
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
      {tabId !== null && <div ref={area} className={styles.loginArea} data-testid="login-area" />}
      <span className="label">{C.logins}</span>
      {logins.isError && <ErrorState error={logins.error} onRetry={() => void logins.refetch()} />}
      <p className="hint">{C.loginsHint}</p>
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

/**
 * Pro mode: the servers the websites' partition logs in to with the user's system login (29 §5.4), a comma-separated
 * list saved when the field is left.
 */
function IntegratedAuth({ servers, set }: { servers: readonly string[]; set: (patch: Partial<Settings>) => void }) {
  const [text, setText] = useState(servers.join(', '));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const next = splitList(text);
    const parsed = integratedAuthServerSchema.array().safeParse(next);
    setInvalid(!parsed.success);
    if (parsed.success && next.join(',') !== servers.join(',')) set({ 'browser.integratedAuthServers': next });
  };
  return (
    <div className="field">
      <label className="label" htmlFor="setting-integrated-auth">
        {C.integratedAuth}
      </label>
      <input
        id="setting-integrated-auth"
        className="input mono"
        placeholder="*.corp.example.com"
        value={text}
        aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <p className="hint">{invalid ? C.integratedAuthInvalid : C.integratedAuthHint}</p>
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
      {settings['ui.mode'] === UiMode.Pro && (
        <>
          <div className="divider" />
          <IntegratedAuth
            key={settings['browser.integratedAuthServers'].join(',')}
            servers={settings['browser.integratedAuthServers']}
            set={set}
          />
        </>
      )}
    </Panel>
  );
}
