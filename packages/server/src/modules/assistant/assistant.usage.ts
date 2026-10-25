import { AssistantTurnEvent, assistantTurnMachine, transition } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { SettingsService } from '../settings/index.ts';
import { type AssistantTurn, createAssistantUsageRepo } from './assistant.usage.repo.ts';

type Active = {
  turn: AssistantTurn;
  remainingMs: number;
  armedAt: number | null;
  cancel: () => void;
  /** 等待权限、停止或删除中（调用方的 pause / resume）。 */
  held: boolean;
  /** opencode 正在重试失败的模型请求，等的是模型服务（D163）。 */
  waitingForModel: boolean;
};

/** 用量与时限独立于对话正文；外部发送前落库，事件结束轮次，权限等待与模型服务重试不消耗时限。 */
export function createAssistantUsage(deps: {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  settings: SettingsService;
  onTimeout(id: string): void;
  /** Whether a turn uses the model changed (started, ended, waits): the model slots recount (D186). */
  onChange(): void;
}) {
  const repo = createAssistantUsageRepo(deps.db);
  const active = new Map<string, Active>();

  function finishTurn(turn: AssistantTurn, event: AssistantTurnEvent) {
    repo.finish(turn, transition(assistantTurnMachine, turn.status, event), event, deps.clock.now());
  }
  // 创建服务发生在处理请求前；上次未结束的轮次只标中断，不自动重新发送。
  for (const turn of repo.running()) finishTurn(turn, AssistantTurnEvent.BackendRestart);

  /** 时限只在既不等用户、也不等模型服务时走。 */
  function settle(state: Active) {
    const running = !state.held && !state.waitingForModel;
    if (running && state.armedAt === null) {
      state.armedAt = deps.clock.now();
      state.cancel = deps.clock.schedule(state.remainingMs, () => deps.onTimeout(state.turn.conversationId));
    } else if (!running && state.armedAt !== null) {
      state.cancel();
      state.remainingMs -= deps.clock.now() - state.armedAt;
      state.armedAt = null;
    } else return;
    deps.onChange();
  }

  function update(id: string, change: Partial<Pick<Active, 'held' | 'waitingForModel'>>) {
    const state = active.get(id);
    if (state === undefined) return;
    Object.assign(state, change);
    settle(state);
  }

  return {
    start(conversationId: string, source: 'user' | 'app', messageId: string) {
      const timeoutMs = deps.settings.get('attempt.timeoutMinutes') * 60_000;
      const turn = repo.create({
        conversationId,
        source,
        model: deps.settings.get('ai.defaultModel'),
        startedAt: deps.clock.now(),
        timeoutMs,
      });
      repo.addMessage(turn, messageId);
      turn.messageIds.push(messageId);
      const state: Active = {
        turn,
        remainingMs: timeoutMs,
        armedAt: null,
        cancel: () => undefined,
        held: false,
        waitingForModel: false,
      };
      active.set(conversationId, state);
      settle(state);
      return { id: turn.id, model: turn.model };
    },
    isRunning: (id: string) => active.has(id),
    finish(id: string, event: AssistantTurnEvent) {
      const state = active.get(id);
      if (state === undefined) return;
      state.cancel();
      finishTurn(state.turn, event);
      active.delete(id);
      deps.onChange();
    },
    /** Turns using the model now: running, not waiting for the user or the model service. */
    usingModel: () => [...active.values()].filter((state) => state.armedAt !== null).length,
    pause: (id: string) => update(id, { held: true }),
    resume: (id: string) => update(id, { held: false }),
    /** opencode 等待重试失败的模型请求（`session.status` 为 `retry`）：这段时间算模型服务的。 */
    waitForModel: (id: string) => update(id, { waitingForModel: true }),
    /** 会话再次发出请求或有进展：按剩余时间继续。 */
    modelAnswering: (id: string) => update(id, { waitingForModel: false }),
    message(id: string, messageId: string, parentMessageId: string | undefined) {
      if (parentMessageId === undefined || repo.byMessage(id, messageId) !== undefined) return;
      const turn = repo.byMessage(id, parentMessageId);
      // 原生 assistant.parentID 指向发起本轮的 user message，迟到消息仍归旧轮。
      if (turn === undefined) return;
      repo.addMessage(turn, messageId);
    },
    ownsActiveMessage(id: string, messageId: string): boolean {
      const running = active.get(id);
      return running !== undefined && repo.byMessage(id, messageId)?.id === running.turn.id;
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
