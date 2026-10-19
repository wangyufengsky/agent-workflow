import { isTerminalState, listTransitions, type Machine } from './define.ts';

/** Mermaid `stateDiagram-v2` of a machine; docs/09 embeds this output and `pnpm gen:fsm-docs --check` keeps it in sync. */
export function toMermaid<S extends string, E extends string>(machine: Machine<S, E>): string {
  const lines = ['stateDiagram-v2'];
  for (const state of machine.initial) lines.push(`  [*] --> ${state}`);
  for (const [from, event, to] of listTransitions(machine)) lines.push(`  ${from} --> ${to}: ${event}`);
  for (const state of machine.states) if (isTerminalState(machine, state)) lines.push(`  ${state} --> [*]`);
  return lines.join('\n');
}
