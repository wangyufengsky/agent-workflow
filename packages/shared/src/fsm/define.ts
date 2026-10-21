import { AppError } from '../errors/app-error.ts';
import { ErrorCode } from '../errors/codes.ts';

/** Every state is listed; a state without events (other than `reopenedBy`) is terminal. */
export type TransitionTable<S extends string, E extends string> = {
  readonly [State in S]: { readonly [Event in E]?: readonly S[] };
};

export type Machine<S extends string, E extends string> = {
  /** Entity name reported in `STATE_TRANSITION_INVALID.details.entity`. */
  readonly entity: string;
  readonly states: readonly S[];
  readonly events: readonly E[];
  /** States an entity can be created in. */
  readonly initial: readonly S[];
  readonly table: TransitionTable<S, E>;
  /**
   * Events that take an entity back out of a terminal state: its work was done, and only this explicit exception
   * resumes it (a completed task revised from review comments, 21 §7). The state still counts as terminal.
   */
  readonly reopenedBy?: readonly E[];
};

export function defineMachine<S extends string, E extends string>(machine: Machine<S, E>): Machine<S, E> {
  return machine;
}

/**
 * Checks that `event` may move an entity from `from` (to `to`) and returns the target state.
 * When the event has several targets the caller picks one: choosing is business logic, the machine only allows.
 */
export function transition<S extends string, E extends string>(machine: Machine<S, E>, from: S, event: E, to?: S): S {
  const targets = machine.table[from][event];
  const target = to ?? (targets?.length === 1 ? targets[0] : undefined);
  if (targets === undefined || target === undefined || !targets.includes(target)) {
    throw new AppError(
      ErrorCode.StateTransitionInvalid,
      `${machine.entity} cannot ${event} from ${from}${to === undefined ? '' : ` to ${to}`}`,
      { entity: machine.entity, from, event, ...(to === undefined ? {} : { to }) },
    );
  }
  return target;
}

export function isTerminalState<S extends string, E extends string>(machine: Machine<S, E>, state: S): boolean {
  return machine.events.every(
    (event) => machine.table[state][event] === undefined || (machine.reopenedBy ?? []).includes(event),
  );
}

/** All `[from, event, to]` triples, ordered by state then event declaration order. */
export function listTransitions<S extends string, E extends string>(machine: Machine<S, E>): Array<[S, E, S]> {
  return machine.states.flatMap((from) =>
    machine.events.flatMap((event) => (machine.table[from][event] ?? []).map((to): [S, E, S] => [from, event, to])),
  );
}
