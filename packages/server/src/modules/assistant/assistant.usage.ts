import { AssistantTurnEvent, assistantTurnMachine, transition } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { SettingsService } from '../settings/index.ts';
import { type AssistantTurn, createAssistantUsageRepo } from './assistant.usage.repo.ts';

type Active = { turn: AssistantTurn; remainingMs: number; armedAt: number | null; cancel: () => void };

/** 用量与时限独立于对话正文；外部发送前落库，事件结束轮次，权限等待不消耗时限。 */
export function createAssistantUsage(deps: {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  settings: SettingsService;
  onTimeout(id: string): void;
}) {
  const repo = createAssistantUsageRepo(deps.db);
  const active = new Map<string, Active>();

  function finishTurn(turn: AssistantTurn, event: AssistantTurnEvent) {
    repo.finish(turn, transition(assistantTurnMachine, turn.status, event), event, deps.clock.now());
  }
  // 创建服务发生在处理请求前；上次未结束的轮次只标中断，不自动重新发送。
  for (const turn of repo.running()) finishTurn(turn, AssistantTurnEvent.BackendRestart);

  function arm(state: Active) {
    state.armedAt = deps.clock.now();
    state.cancel = deps.clock.schedule(state.remainingMs, () => deps.onTimeout(state.turn.conversationId));
  }

  return {
    start(conversationId: string, source: 'user' | 'app') {
      const timeoutMs = deps.settings.get('attempt.timeoutMinutes') * 60_000;
      const turn = repo.create({
        conversationId,
        source,
        model: deps.settings.get('ai.defaultModel'),
        startedAt: deps.clock.now(),
        timeoutMs,
      });
      const state: Active = { turn, remainingMs: timeoutMs, armedAt: null, cancel: () => undefined };
      active.set(conversationId, state);
      arm(state);
    },
    isRunning: (id: string) => active.has(id),
    finish(id: string, event: AssistantTurnEvent) {
      const state = active.get(id);
      if (state === undefined) return;
      state.cancel();
      finishTurn(state.turn, event);
      active.delete(id);
    },
    pause(id: string) {
      const state = active.get(id);
      if (state === undefined || state.armedAt === null) return;
      state.cancel();
      state.remainingMs -= deps.clock.now() - state.armedAt;
      state.armedAt = null;
    },
    resume(id: string) {
      const state = active.get(id);
      if (state !== undefined && state.armedAt === null) arm(state);
    },
    message(id: string, messageId: string) {
      const state = active.get(id);
      if (state === undefined || repo.byMessage(id, messageId) !== undefined) return;
      repo.addMessage(state.turn, messageId);
      state.turn.messageIds.push(messageId);
    },
    step(id: string, messageId: string, partId: string, tokens: { input: number; output: number }) {
      return deps.unit.transact(() => {
        const turn = repo.byMessage(id, messageId);
        // 未观察到所属轮次的报告不能猜到当前轮；旧报告重放也不能累计两次。
        if (turn === undefined || turn.stepIds.includes(partId)) return false;
        repo.addUsage(turn, partId, tokens);
        return true;
      });
    },
    summaries: (ids: string[]) => repo.summaries(ids, deps.clock.now()),
    get(id: string) {
      const summary = repo.summaries([id], deps.clock.now()).get(id);
      if (summary === undefined) throw new Error('Missing assistant usage summary');
      return summary;
    },
    dispose() {
      for (const state of active.values()) state.cancel();
      active.clear();
    },
  };
}
