import { assistantConfirmationMachine } from './assistant-confirmation.machine.ts';
import { attemptMachine } from './attempt.machine.ts';
import { deliveryMachine } from './delivery.machine.ts';
import { inboxMachine } from './inbox.machine.ts';
import { nodeMachine } from './node.machine.ts';
import { planMachine } from './plan.machine.ts';
import { previewMachine } from './preview.machine.ts';
import { runtimeMachine } from './runtime.machine.ts';
import { scheduleMachine } from './schedule.machine.ts';
import { taskMachine } from './task.machine.ts';
import { worktreeMachine } from './worktree.machine.ts';

export * from './assistant-confirmation.machine.ts';
export * from './attempt.machine.ts';
export * from './define.ts';
export * from './delivery.machine.ts';
export * from './inbox.machine.ts';
export * from './mermaid.ts';
export * from './node.machine.ts';
export * from './plan.machine.ts';
export * from './preview.machine.ts';
export * from './runtime.machine.ts';
export * from './schedule.machine.ts';
export * from './task.machine.ts';
export * from './worktree.machine.ts';

/** Every machine documented in docs/09, keyed by its doc marker name. */
export const MACHINES = {
  task: taskMachine,
  node: nodeMachine,
  attempt: attemptMachine,
  plan: planMachine,
  worktree: worktreeMachine,
  delivery: deliveryMachine,
  inbox: inboxMachine,
  runtime: runtimeMachine,
  assistantConfirmation: assistantConfirmationMachine,
  schedule: scheduleMachine,
  preview: previewMachine,
} as const;
