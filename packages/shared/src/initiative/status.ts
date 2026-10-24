import { DeliveryStatus, DeliveryStrategy, isLocalMerge } from '../enums/git.ts';
import { InitiativeItemStatus, InitiativeStatus } from '../enums/initiative.ts';
import { TaskStatus } from '../enums/task.ts';
import { WorkflowDeliverable } from '../enums/workflow.ts';
import { isTerminalState } from '../fsm/define.ts';
import { taskMachine } from '../fsm/task.machine.ts';

/** What a work package's display state is derived from (34 §6.1). */
export type InitiativeItemFacts = {
  droppedAt: number | null;
  mergeConfirmedAt: number | null;
  /** The current task's state, or null before it first started. */
  task: { status: TaskStatus } | null;
  /** The workflow's deliverable; null when the workflow no longer exists. */
  deliverable: WorkflowDeliverable | null;
  /** The current task's latest delivery of its current round. */
  lastDelivery: { status: DeliveryStatus; strategy: DeliveryStrategy; targetBranch: string } | null;
};

const completedTask = (facts: InitiativeItemFacts) => facts.task?.status === TaskStatus.Completed;

const deliveredAsPullRequest = (facts: InitiativeItemFacts) =>
  facts.lastDelivery?.status === DeliveryStatus.Succeeded &&
  facts.lastDelivery.strategy === DeliveryStrategy.PullRequest;

/**
 * Whether a work package no longer holds up its dependents (D134 ②③): dropped; or its task completed by finishing
 * a report, by a local merge into the initiative's base branch, or by a pull request the user marked merged.
 */
export function isInitiativeItemDone(facts: InitiativeItemFacts, baseBranch: string): boolean {
  if (facts.droppedAt !== null) return true;
  if (!completedTask(facts)) return false;
  if (facts.deliverable === WorkflowDeliverable.Report) return true;
  if (deliveredAsPullRequest(facts)) return facts.mergeConfirmedAt !== null;
  const delivery = facts.lastDelivery;
  return (
    delivery !== null &&
    delivery.status === DeliveryStatus.Succeeded &&
    isLocalMerge(delivery.strategy) &&
    delivery.targetBranch === baseBranch
  );
}

/** A work package's display state (34 §6.1); `depsDone` is whether every work package it depends on is done. */
export function initiativeItemStatusOf(
  facts: InitiativeItemFacts,
  where: { baseBranch: string; phaseOpened: boolean; depsDone: boolean },
): InitiativeItemStatus {
  if (facts.droppedAt !== null) return InitiativeItemStatus.Dropped;
  if (isInitiativeItemDone(facts, where.baseBranch)) return InitiativeItemStatus.Satisfied;
  if (completedTask(facts) && deliveredAsPullRequest(facts)) return InitiativeItemStatus.PrOpen;
  if (facts.task !== null && !isTerminalState(taskMachine, facts.task.status)) return InitiativeItemStatus.InTask;
  if (!where.phaseOpened) return InitiativeItemStatus.PhaseClosed;
  if (!where.depsDone) return InitiativeItemStatus.Waiting;
  return InitiativeItemStatus.Ready;
}

/**
 * An initiative's display state (34 §6.2) from its latest AI run, its revisions, opened phases and which work
 * packages are done. `run` is null without any breakdown run.
 */
export function initiativeStatusOf(input: {
  run: { active: boolean } | null;
  breakdownRev: number;
  confirmedRev: number;
  openedPhase: number;
  phaseCount: number;
  items: ReadonlyArray<{ phase: number; done: boolean }>;
}): InitiativeStatus {
  if (input.run?.active === true) return InitiativeStatus.BreakingDown;
  if (input.items.length === 0) return InitiativeStatus.BreakdownFailed;
  if (input.confirmedRev < input.breakdownRev) return InitiativeStatus.DraftReady;
  if (input.items.every((item) => item.done)) return InitiativeStatus.Done;
  const openedDone = input.items.filter((item) => item.phase <= input.openedPhase).every((item) => item.done);
  return openedDone && input.openedPhase < input.phaseCount ? InitiativeStatus.PhaseDone : InitiativeStatus.InProgress;
}
