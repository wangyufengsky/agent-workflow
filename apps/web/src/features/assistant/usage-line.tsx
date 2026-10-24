import { type AssistantTurnDTO, AssistantTurnEvent, AssistantTurnStatus, type AssistantUsageDTO } from '@aw/shared';
import { useId } from 'react';
import { Elapsed } from '../../components/elapsed.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_USAGE_COPY as C } from '../../copy/assistant.ts';
import styles from './assistant.module.css';

/** 「最近一轮 · 已完成 · 输入 … · 输出 … tokens」: the turn's line without its time. */
function turnLine(turn: AssistantTurnDTO): string {
  const status =
    turn.endReason === AssistantTurnEvent.BackendRestart
      ? C.stoppedByRestart
      : turn.endReason === AssistantTurnEvent.RuntimeLost
        ? C.stoppedByRuntime
        : C.status[turn.status];
  return `${turn.status === AssistantTurnStatus.Running ? C.current : C.latest} · ${status} · ${C.tokens(turn.tokensInput, turn.tokensOutput)}`;
}

/**
 * 三个聊天入口共用的「助手用量」按钮（15 §6.2、36 §3）：只展示模型实际报告的用量，缺失与中断都有明确标签；悬停看最近一轮的一句
 * 摘要，点开在浮层里看完整三行。还没有用量记录时不显示。
 */
export function UsageButton({ usage }: { usage: AssistantUsageDTO }) {
  const id = useId();
  const turn = usage.latest;
  if (turn === null || usage.recordedFrom === null) return null;
  return (
    <>
      <button type="button" className={styles.footIcon} popoverTarget={id} aria-label={C.label} title={turnLine(turn)}>
        <Icon name="gauge" size="sm" />
      </button>
      <div id={id} popover="auto" role="dialog" aria-label={C.label} className={styles.usagePop}>
        <div>
          {turnLine(turn)} · {C.elapsed}{' '}
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
      </div>
    </>
  );
}
