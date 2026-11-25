import { type ContextDetailDTO, contextStatus, getAssistantContextOp, getAttemptContextOp } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { CONTEXT_COPY as C } from '../../copy/context.ts';
import styles from './context.module.css';

type Status = ContextDetailDTO['messages'][number]['status'];
const fmt = (n: number | null) => (n === null ? C.unknown : n.toLocaleString());
export function ContextContents({ data }: { data: ContextDetailDTO }) {
  const [filter, setFilter] = useState<Status | null>(null);
  const [onlySent, setOnlySent] = useState(false);
  const { budget: b } = data;
  const used = b
    ? b.blocked
      ? b.before
      : b.after
    : data.reconstructed
      ? data.historyEstimate
      : (data.measuredInput ?? data.historyEstimate);
  const ratio = used !== null && data.limit !== null && data.limit > 0 ? used / data.limit : null;
  const parts = b
    ? [
        b.systemTokens,
        b.toolTokens + b.externalTokens,
        b.dialogueTokens,
        b.toolOutputTokens,
        b.summaryTokens,
        b.mediaTokens,
      ]
    : [
        data.historyParts.system,
        data.historyParts.tools,
        data.historyParts.dialogue,
        data.historyParts.toolOutput,
        data.historyParts.summary,
        data.historyParts.media,
      ];
  const messages = data.messages.filter((m) => (!onlySent || m.sent) && (!filter || m.status === filter));
  return (
    <div className={styles.content}>
      <section>
        <h3>{C.input}</h3>
        <div className={styles.amount}>
          {fmt(used)} <small>/ {fmt(data.limit)} tokens</small>
        </div>
        <div>
          {b ? C.estimated : data.reconstructed || data.measuredInput === null ? C.historyEstimate : C.measured} ·{' '}
          {b ? C.limit : C.nativeLimit}
          {data.model && ` · ${data.model}`}
        </div>
        {ratio !== null && (
          <>
            <div className={styles.track}>
              <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              <i />
            </div>
            <small>
              {Math.round(ratio * 100)}% · {C.soft}
            </small>
          </>
        )}
        {b && b.before > b.after && <p className={styles.badge}>{C.saved(fmt(b.before - b.after))}</p>}
        {b?.overBudgetWarning && !b.blocked && <p className={styles.alert}>{C.warning}</p>}
        {(data.stopped || b?.blocked) && <p className={styles.alert}>{C.stopped}</p>}
        {data.reconstructed && <small>{C.reconstructed}</small>}
        {data.compactionRequests > 0 && (
          <p>
            {data.managed
              ? C.recoveryCount(data.compactionRequests, data.compactions)
              : C.compactions(data.compactions)}
          </p>
        )}
        {data.messages.length > 0 && (
          <>
            <h4>{b ? C.breakdown : C.historyEstimate}</h4>
            <div className={styles.stack}>
              {parts.map((v, i) => (
                <span key={C.parts[i]} style={{ flexGrow: v ?? 0 }} />
              ))}
            </div>
            <dl>
              {parts.map((v, i) => (
                <div key={C.parts[i]}>
                  <dt>{C.parts[i]}</dt>
                  <dd>{fmt(v)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <dl>
          {(b || data.reconstructed) && data.measuredInput !== null && (
            <div>
              <dt>{C.measured}</dt>
              <dd>{fmt(data.measuredInput)}</dd>
            </div>
          )}
          <div>
            <dt>{C.cache}</dt>
            <dd>{fmt(data.cacheRead)}</dd>
          </div>
          {b && (
            <>
              <div>
                <dt>{C.reserve}</dt>
                <dd>{fmt(b.outputReserve)}</dd>
              </div>
              <div>
                <dt>{C.ratio}</dt>
                <dd>
                  {b.bytesPerToken.toFixed(2)} · {b.calibrated ? C.calibrated : C.initial}
                </dd>
              </div>
            </>
          )}
        </dl>
      </section>
      {data.managed && (data.summary || data.folded.length > 0) && (
        <section>
          <h3>{C.compression}</h3>
          {data.summary && (
            <details>
              <summary>
                {C.summary} · {fmt(data.summary.summaryText.length)} {C.chars}
              </summary>
              <small>
                {data.summary.uptoMessageId} · {new Date(data.summary.updatedAt).toLocaleString()}
              </small>
              <pre>{data.summary.summaryText}</pre>
            </details>
          )}
          {data.folded.length > 0 && <h4>{C.folded}</h4>}
          {data.folded.map((p) => (
            <details key={p.partId}>
              <summary>
                {p.path} · {fmt(p.length)} → {fmt(p.referenceLength)} {C.chars}
              </summary>
              <small>
                {p.messageId} / {p.partId}
              </small>
              <pre>{p.preview}</pre>
              {p.truncated && <small>{C.truncated}</small>}
            </details>
          ))}
        </section>
      )}
      <section>
        <h3>{C.messages}</h3>
        <label>
          <input type="checkbox" checked={onlySent} onChange={(e) => setOnlySent(e.target.checked)} />{' '}
          {data.reconstructed ? C.projectedOnly : C.onlySent}
        </label>
        <div className={styles.filters}>
          {[null, ...contextStatus.options].map((s) => (
            <button type="button" key={s ?? 'all'} aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {s ? C.status[s] : C.all}
            </button>
          ))}
        </div>
        {messages.map((m) => (
          <details key={m.id}>
            <summary>
              <b>{m.role === 'assistant' ? C.assistant : C.user}</b> · {m.title}{' '}
              <small>
                {C.status[m.status]} ·{' '}
                {m.tokens === m.projectedTokens ? fmt(m.tokens) : `${fmt(m.tokens)} → ${fmt(m.projectedTokens)}`} tokens
              </small>
            </summary>
            <small>
              {m.id} · {fmt(m.length)} {C.chars}
            </small>
            <pre>{onlySent ? (m.projectedPreview ?? m.preview) : m.preview}</pre>
            {m.truncated && <small>{C.truncated}</small>}
          </details>
        ))}
        {messages.length === 0 && <p>{C.empty}</p>}
      </section>
    </div>
  );
}
export function ContextDrawer({
  id,
  source,
  open,
  onOpenChange,
}: {
  id: string;
  source: 'attempt' | 'assistant';
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ['context', source, id],
    enabled: open,
    queryFn: () =>
      source === 'attempt' ? callOperation(getAttemptContextOp, { id }) : callOperation(getAssistantContextOp, { id }),
  });
  return (
    <Drawer
      size="lg"
      title={C.title}
      open={open}
      onOpenChange={onOpenChange}
      footer={
        <Button pending={query.isFetching} onClick={() => void query.refetch()}>
          {C.refresh}
        </Button>
      }
    >
      {query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data ? (
        <ContextContents key={id} data={query.data} />
      ) : (
        <p>{C.loading}</p>
      )}
    </Drawer>
  );
}
