import { AssistantTurnEvent, AssistantTurnStatus, type AssistantUsageDTO } from '@aw/shared';
import { Elapsed } from '../../components/elapsed.tsx';
import { ASSISTANT_USAGE_COPY as C } from '../../copy/assistant.ts';

/** 三个聊天入口共用：只展示模型实际报告的用量，缺失与中断都有明确标签。 */
export function UsageLine({ usage }: { usage: AssistantUsageDTO }) {
  const turn = usage.latest;
  if (turn === null || usage.recordedFrom === null) return null;
  const status =
    turn.endReason === AssistantTurnEvent.BackendRestart
      ? C.stoppedByRestart
      : turn.endReason === AssistantTurnEvent.RuntimeLost
        ? C.stoppedByRuntime
        : C.status[turn.status];
  return (
    <section className="hint" aria-label={C.label}>
      <div>
        {turn.status === AssistantTurnStatus.Running ? C.current : C.latest} · {status} ·{' '}
        {C.tokens(turn.tokensInput, turn.tokensOutput)} · {C.elapsed}{' '}
        {turn.status === AssistantTurnStatus.Running ? (
          <Elapsed since={turn.startedAt} />
        ) : turn.elapsedMs === null ? (
          C.unknownElapsed
        ) : (
          C.duration(turn.elapsedMs)
        )}
      </div>
      <div title={C.since(usage.recordedFrom)}>
        {C.total(usage.tokensInput, usage.tokensOutput, usage.unknownTurns)} · {C.recordedSince(usage.recordedFrom)}
      </div>
      <div>{C.limit(turn.timeoutMs)}</div>
    </section>
  );
}
