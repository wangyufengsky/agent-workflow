import {
  ErrorCode,
  getOpencodeHeadersOp,
  getStartupEnvironmentOp,
  opencodeHeadersInputSchema,
  setOpencodeHeadersOp,
  setStartupEnvironmentOp,
  startupEnvironmentInputSchema,
} from '@aw/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { z } from 'zod';
import { ApiError, callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { OPENCODE_HEADERS_COPY, STARTUP_ENVIRONMENT_COPY } from '../../copy/settings.ts';
import styles from './startup-environment.module.css';

type Snapshot = z.output<typeof getStartupEnvironmentOp.output>;
type Item = Snapshot['items'][number];
type Row = { id: string; name: string; secret: boolean; value: string | undefined };
type Draft = { base: Snapshot; rows: Row[] };

const environmentEditor = {
  copy: STARTUP_ENVIRONMENT_COPY,
  query: queryOptions({
    queryKey: ['settings', 'startup-environment'],
    queryFn: () => callOperation(getStartupEnvironmentOp, {}),
  }),
  schema: startupEnvironmentInputSchema,
  save: (input: z.output<typeof startupEnvironmentInputSchema>) => callOperation(setStartupEnvironmentOp, input),
};
const headerEditor = {
  copy: OPENCODE_HEADERS_COPY,
  query: queryOptions({
    queryKey: ['settings', 'opencode-headers'],
    queryFn: () => callOperation(getOpencodeHeadersOp, {}),
  }),
  schema: opencodeHeadersInputSchema,
  save: (input: z.output<typeof opencodeHeadersInputSchema>) => callOperation(setOpencodeHeadersOp, input),
};

const visibleValue = (item: Item) => (item.secret ? undefined : item.value);

const rowsFrom = (snapshot: Snapshot): Row[] =>
  snapshot.items.map((item) => ({ id: item.name, name: item.name, secret: item.secret, value: visibleValue(item) }));

const isRevisionConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 409 && error.code === ErrorCode.StateTransitionInvalid;

function canKeep(row: Row, saved: readonly Item[]): boolean {
  return (
    row.secret &&
    row.id.toUpperCase() === row.name.trim().toUpperCase() &&
    saved.some(({ name, secret }) => secret && name === row.id)
  );
}

function KeyValueSettings({ editor }: { editor: typeof headerEditor | typeof environmentEditor }) {
  const C = editor.copy;
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const client = useQueryClient();
  const query = useQuery(editor.query);
  const [draft, setDraft] = useState<Draft>();
  const [saved, setSaved] = useState(false);
  const nextId = useRef(0);
  const snapshot = query.data;
  const rows = draft?.rows ?? (snapshot === undefined ? [] : rowsFrom(snapshot));
  const base = draft?.base ?? snapshot;
  const parsed = editor.schema.safeParse({
    expectedRevision: draft?.base.revision,
    items: rows.map(({ name, secret, value }) => ({ name, secret, ...(value === undefined ? {} : { value }) })),
  });
  const missingValue = rows.some((row) => row.value === undefined && !canKeep(row, base?.items ?? []));
  const save = useMutation({
    gcTime: 0,
    mutationFn: editor.save,
    onError: async (error) => {
      if (isRevisionConflict(error)) await query.refetch();
    },
    onSuccess: async (result) => {
      await client.cancelQueries({ queryKey: editor.query.queryKey, exact: true });
      client.setQueryData(editor.query.queryKey, result);
      setDraft(undefined);
      setSaved(true);
      save.reset();
    },
  });

  const stale =
    draft !== undefined &&
    (isRevisionConflict(save.error) || (snapshot !== undefined && snapshot.revision !== draft.base.revision));

  async function discardDraft() {
    if (stale && query.isError) {
      const result = await query.refetch();
      if (result.isError) return;
    }
    setDraft(undefined);
    save.reset();
  }

  function edit(change: (before: Row[]) => Row[]) {
    if (snapshot === undefined) return;
    setSaved(false);
    save.reset();
    setDraft((previous) => ({
      base: previous?.base ?? snapshot,
      rows: change(previous?.rows ?? rowsFrom(snapshot)),
    }));
  }

  function update(id: string, patch: Partial<Omit<Row, 'id'>>) {
    edit((before) => before.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <section className={styles.section} aria-label={C.title}>
      <div className="row wrap">
        <h3 className="section-title grow">
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((open) => !open)}
          >
            <Icon name={expanded ? 'chevDown' : 'chevRight'} size="sm" />
            {C.title}
          </button>
        </h3>
        <Button
          size="sm"
          icon="plus"
          disabled={snapshot === undefined || save.isPending || stale}
          onClick={() => {
            setExpanded(true);
            const id = `new:${nextId.current++}`;
            edit((before) => [...before, { id, name: '', secret: false, value: '' }]);
          }}
        >
          {C.add}
        </Button>
      </div>
      <div id={contentId} className={styles.content} hidden={!expanded}>
        <p className="hint">{C.description}</p>
        {query.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {snapshot !== undefined && (
          <form
            className="col"
            onSubmit={(event) => {
              event.preventDefault();
              if (parsed.success && !missingValue && !stale && draft !== undefined && !save.isPending)
                save.mutate(parsed.data);
            }}
          >
            {rows.length === 0 && <p className="hint">{C.empty}</p>}
            {rows.map((row, index) => {
              const issues = parsed.error?.issues.filter(({ path }) => path[0] === 'items' && path[1] === index) ?? [];
              const invalidName = issues.some(({ path }) => path[2] === 'name');
              const invalidValue = issues.some(({ path }) => path[2] === 'value');
              const retained = row.value === undefined && canKeep(row, base?.items ?? []);
              return (
                <fieldset key={row.id} className={styles.row} disabled={save.isPending || stale}>
                  <legend>{C.row(index + 1)}</legend>
                  <label className="col">
                    <span className="label">{C.name}</span>
                    <input
                      className="input mono"
                      value={row.name}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={invalidName || undefined}
                      onChange={(event) => update(row.id, { name: event.currentTarget.value })}
                    />
                  </label>
                  <label className="col">
                    <span className="label">{C.value}</span>
                    <input
                      className="input mono"
                      type={row.secret ? 'password' : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      value={row.value ?? ''}
                      placeholder={retained ? C.secretSaved : undefined}
                      aria-invalid={invalidValue || (row.value === undefined && !retained) || undefined}
                      onChange={(event) => update(row.id, { value: event.currentTarget.value })}
                    />
                  </label>
                  <div className="row wrap">
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={row.secret}
                        onChange={(event) => update(row.id, { secret: event.currentTarget.checked })}
                      />
                      {C.secret}
                    </label>
                    <Button
                      size="sm"
                      icon="trash"
                      aria-label={C.removeRow(index + 1)}
                      onClick={() => edit((before) => before.filter(({ id }) => id !== row.id))}
                    >
                      {C.remove}
                    </Button>
                  </div>
                  {retained && (
                    <div className={styles.note}>
                      <Button size="sm" variant="ghost" onClick={() => update(row.id, { value: '' })}>
                        {C.replaceSecret}
                      </Button>
                    </div>
                  )}
                  {row.value === undefined && !retained && (
                    <div className={styles.note}>
                      <p className="error-text">{C.enterNewValue}</p>
                      <Button size="sm" variant="ghost" onClick={() => update(row.id, { value: '' })}>
                        {C.useEmptyValue}
                      </Button>
                    </div>
                  )}
                </fieldset>
              );
            })}
            {parsed.error?.issues.some(({ path }) => path[2] === 'name') && <p className="error-text">{C.invalid}</p>}
            {parsed.error?.issues.some(({ path }) => path[2] === 'value') && (
              <p className="error-text">{C.invalidValue}</p>
            )}
            {save.isError && !isRevisionConflict(save.error) && <ErrorState error={save.error} />}
            {stale && <p role="status">{C.stale}</p>}
            <div className="row wrap">
              <Button
                type="submit"
                variant="primary"
                pending={save.isPending}
                disabled={draft === undefined || !parsed.success || missingValue || stale}
              >
                {C.save}
              </Button>
              {draft !== undefined && (
                <Button disabled={save.isPending || (stale && query.isFetching)} onClick={() => void discardDraft()}>
                  {stale ? C.useLatest : COMMON_COPY.cancel}
                </Button>
              )}
              {saved && (
                <span className="hint" role="status">
                  {C.saved}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

export function StartupEnvironmentSettings() {
  return (
    <div className="col">
      <KeyValueSettings editor={environmentEditor} />
      <KeyValueSettings editor={headerEditor} />
    </div>
  );
}
