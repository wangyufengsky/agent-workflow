import {
  type HostingAccountDTO,
  HostingProvider,
  hostingProviderSchema,
  listHostingAccountsOp,
  removeHostingAccountOp,
  type SetHostingAccountRequest,
  setHostingAccountOp,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { PROJECTS_COPY as P } from '../../copy/projects.ts';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import styles from './websites.module.css';

/** A global token changes which projects can open PRs: their details carry the effective hosting (D155). */
function useHostingAccountMutation<I, O>(run: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.hostingAccounts }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]),
  });
}

type Draft = { provider: HostingProvider; baseUrl: string };

function AccountForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [provider, setProvider] = useState(draft.provider);
  const [baseUrl, setBaseUrl] = useState(draft.baseUrl);
  const [token, setToken] = useState('');
  const save = useHostingAccountMutation((input: SetHostingAccountRequest) =>
    callOperation(setHostingAccountOp, input),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save
      .mutateAsync({
        provider,
        ...(provider === HostingProvider.Gitlab && baseUrl.trim() !== '' ? { baseUrl: baseUrl.trim() } : {}),
        token: token.trim(),
      })
      .then(
        () => {
          toast(C.hostingAccountSaved);
          onDone();
        },
        () => undefined,
      );
  };
  return (
    <form onSubmit={submit} aria-label={C.hostingAccountAdd}>
      <div className="field">
        <label className="label" htmlFor="global-hosting-provider">
          {P.hostingProvider}
        </label>
        <select
          id="global-hosting-provider"
          className="select"
          value={provider}
          onChange={(e) => setProvider(hostingProviderSchema.parse(e.target.value))}
        >
          {Object.values(HostingProvider).map((p) => (
            <option key={p} value={p}>
              {P.providers[p]}
            </option>
          ))}
        </select>
      </div>
      {provider === HostingProvider.Gitlab && (
        <div className="field">
          <label className="label" htmlFor="global-hosting-base-url">
            {P.hostingBaseUrl}
          </label>
          <input
            id="global-hosting-base-url"
            className="input mono"
            placeholder="https://gitlab.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="hint">{P.hostingBaseUrlHint}</p>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="global-hosting-token">
          {P.hostingToken}
        </label>
        <input
          id="global-hosting-token"
          className="input mono"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="hint">{C.hostingAccountTokenHint}</p>
      </div>
      {save.isError && <ErrorState error={save.error} />}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" pending={save.isPending} disabled={token.trim() === ''}>
          {P.hostingSave}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {C.hostingAccountCancel}
        </Button>
      </div>
    </form>
  );
}

function AccountRow({ account, onReplace }: { account: HostingAccountDTO; onReplace: () => void }) {
  const remove = useHostingAccountMutation((id: string) => callOperation(removeHostingAccountOp, { id }));
  return (
    <li>
      <b>{P.providers[account.provider]}</b>
      <span className="grow mono">{C.hostingAddress(account.provider, account.baseUrl)}</span>
      <span className="hint">{C.hostingAccountAs(account.account)}</span>
      <Button size="sm" onClick={onReplace}>
        {C.hostingAccountReplace}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        pending={remove.isPending}
        onClick={() =>
          remove.mutateAsync(account.id).then(
            () => toast(C.hostingAccountRemoved),
            () => undefined,
          )
        }
      >
        {C.hostingAccountRemove}
      </Button>
      {remove.isError && <ErrorState error={remove.error} />}
    </li>
  );
}

/** Global GitHub / GitLab tokens (D155, pro): used by projects that have no token of their own. */
export function HostingAccountsSettings() {
  const accounts = useQuery({
    queryKey: queryKeys.hostingAccounts,
    queryFn: async () => (await callOperation(listHostingAccountsOp, {})).items,
  });
  const [draft, setDraft] = useState<Draft | undefined>();
  return (
    <Panel title={C.hostingAccounts}>
      <p className={`hint ${styles.lede}`}>{C.hostingAccountsLede}</p>
      {accounts.isError && <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />}
      {accounts.data?.length === 0 && <p className="hint">{C.hostingAccountsNone}</p>}
      {accounts.data !== undefined && accounts.data.length > 0 && (
        <ul className={styles.logins} aria-label={C.hostingAccounts}>
          {accounts.data.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              onReplace={() => setDraft({ provider: a.provider, baseUrl: a.baseUrl ?? '' })}
            />
          ))}
        </ul>
      )}
      {draft === undefined ? (
        <div className={styles.actions}>
          <Button icon="plus" onClick={() => setDraft({ provider: HostingProvider.Github, baseUrl: '' })}>
            {C.hostingAccountAdd}
          </Button>
        </div>
      ) : (
        <AccountForm key={`${draft.provider}:${draft.baseUrl}`} draft={draft} onDone={() => setDraft(undefined)} />
      )}
    </Panel>
  );
}
