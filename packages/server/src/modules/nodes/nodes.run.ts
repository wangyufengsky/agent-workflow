import { EMPTY_SECTION, PromptName, renderTemplate } from '@aw/builtin';
import {
  AcceptanceCheckKind,
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  type CheckResult,
  type CheckUnrunnableReason,
  ErrorCode,
  InboxKind,
  NodeEvent,
  NodeStatus,
  nodeMachine,
  type ResultNext,
  type SubmitResultInput,
  transition,
} from '@aw/shared';
import type { CommandCheckResult } from '../acceptance/index.ts';
import type { Attempt } from '../attempts/index.ts';
import { BACKEND_COMMITTER, hasMergeHead, runGit } from '../git/index.ts';
import type { createNodesRepo, Node, NodeChanges } from './nodes.repo.ts';
import { feedbackFromAttempt, feedbackFromChecks, feedbackFromRejection, nextAfterFailure } from './nodes.rules.ts';
import type { NodeRunContext, NodesServiceDeps } from './nodes.types.ts';

/** A check command the app's environment could not run, and why (D116). */
export type UnrunnableCheck = { command: string; program: string; reason: CheckUnrunnableReason };

type NodeState = {
  repo: ReturnType<typeof createNodesRepo>;
  get(id: string): Node;
  move(node: Node, event: NodeEvent, to?: NodeStatus, changes?: NodeChanges): Node;
};

/**
 * Running a node (09 §3): dispatching its execute attempt, receiving the result, verifying it, committing the work
 * when the node is done, and reacting to attempts that end without a result.
 */
export function createNodeRunner(deps: NodesServiceDeps, { repo, get, move }: NodeState) {
  const { unit, clock, log, attempts, acceptance, inbox, roles, settings, prompts, locks } = deps;
  /** Verifications in progress, by node, so cancelling the task can stop them. */
  const verifications = new Map<string, AbortController>();

  /** Another attempt while budget remains, otherwise failed (09 §3). */
  function fail(node: Node, event: NodeEvent, feedback: string, changes: NodeChanges = {}): Node {
    const to = nextAfterFailure(node.attemptCount, settings.get('node.maxAttempts'));
    return move(node, event, to, {
      ...changes,
      retryFeedback: feedback,
      ...(to === NodeStatus.Failed ? { finishedAt: clock.now() } : {}),
    });
  }

  /** Back to ready without using budget: the work was lost with the runtime or the app (09 §3 restart rules). */
  function interrupt(node: Node): Node {
    return move(node, NodeEvent.Interrupted, NodeStatus.Ready, { attemptCount: Math.max(0, node.attemptCount - 1) });
  }

  /**
   * The backend commits a finished node's changes (09 §3); none → no commit. A merge in progress (the target branch
   * merged in for a conflict resolution, 13 §4) is concluded by this commit even when it brings no changes.
   */
  async function commit(node: Node, ctx: NodeRunContext): Promise<string | null> {
    return locks.run(ctx.repoPath, async () => {
      const cwd = ctx.directory;
      const { stdout } = await runGit(['status', '--porcelain'], { cwd });
      if (stdout.trim() === '' && !(await hasMergeHead(cwd))) return null;
      await runGit(['add', '-A'], { cwd });
      // The node's acceptance checks are the gate; the user's hooks may be slow or interactive.
      await runGit([...BACKEND_COMMITTER, 'commit', '--quiet', '--no-verify', '-m', `${ctx.taskKey} ${node.title}`], {
        cwd,
      });
      return (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    });
  }

  const doneChanges = (sha: string | null): NodeChanges => ({ commitSha: sha, finishedAt: clock.now() });

  /** A check the user skipped after it could not run (D116): not run, and it does not hold the step back. */
  const skippedResult = (command: string): CheckResult => ({
    kind: AcceptanceCheckKind.Command,
    command,
    passed: true,
    output: '',
    exitCode: null,
    timedOut: false,
    unrunnable: null,
    skipped: true,
  });

  function requestAcceptance(node: Node): void {
    inbox.create({
      kind: InboxKind.Acceptance,
      taskId: node.taskId,
      nodeId: node.id,
      attemptId: null,
      title: node.title,
      payload: {},
    });
  }

  async function verify(nodeId: string, ctx: NodeRunContext): Promise<void> {
    const controller = new AbortController();
    verifications.set(nodeId, controller);
    try {
      const node = get(nodeId);
      if (node.result === null) throw new Error(`Node ${nodeId} is verifying without a result`);
      const results: CheckResult[] = [];
      for (const check of node.acceptance.checks) {
        if (check.kind === AcceptanceCheckKind.Command) {
          results.push(
            check.skipped === true
              ? skippedResult(check.command)
              : await acceptance.runCommand(ctx.directory, check.command, controller.signal),
          );
        } else {
          const outcome = await acceptance.review(
            {
              nodeId,
              taskId: ctx.taskId,
              projectId: ctx.projectId,
              taskKey: ctx.taskKey,
              taskTitle: ctx.taskTitle,
              requirement: ctx.requirement,
              nodeTitle: node.title,
              instructions: node.instructions,
              resultSummary: node.result.summary,
              focus: check.focus,
              directory: ctx.directory,
              checkCommands: [
                ...(ctx.checkCommand === null ? [] : [ctx.checkCommand]),
                ...node.acceptance.checks.flatMap((c) => (c.kind === AcceptanceCheckKind.Command ? [c.command] : [])),
              ],
            },
            controller.signal,
          );
          if (outcome.interrupted) {
            const current = get(nodeId);
            if (current.status === NodeStatus.Verifying) interrupt(current);
            return;
          }
          results.push(outcome.result);
        }
        if (controller.signal.aborted || results.at(-1)?.passed !== true) break;
      }
      await finishVerification(nodeId, results, ctx);
    } finally {
      verifications.delete(nodeId);
    }
  }

  async function finishVerification(nodeId: string, results: CheckResult[], ctx: NodeRunContext): Promise<void> {
    const node = get(nodeId);
    // Cancelled (or otherwise moved on) while the checks ran.
    if (node.status !== NodeStatus.Verifying) return;
    if (results.some((r) => r.kind === AcceptanceCheckKind.Command && r.unrunnable !== null)) {
      // The environment, not the model, failed: no feedback, and the attempt does not count (D116).
      move(node, NodeEvent.CheckUnrunnable, NodeStatus.Failed, {
        checkResults: results,
        attemptCount: Math.max(0, node.attemptCount - 1),
        finishedAt: clock.now(),
      });
      return;
    }
    if (!results.every((r) => r.passed)) {
      fail(node, NodeEvent.ChecksFailed, feedbackFromChecks(results), { checkResults: results });
      return;
    }
    const target = node.acceptance.manual ? NodeStatus.AwaitingAcceptance : NodeStatus.Done;
    const sha = target === NodeStatus.Done ? await commit(node, ctx) : null;
    const current = get(nodeId);
    if (current.status !== NodeStatus.Verifying) return;
    unit.transact(() => {
      move(current, NodeEvent.ChecksPassed, target, {
        checkResults: results,
        ...(target === NodeStatus.Done ? doneChanges(sha) : {}),
      });
      if (target === NodeStatus.AwaitingAcceptance) requestAcceptance(current);
    });
  }

  function onAttemptEnded(node: Node, attempt: Attempt): void {
    if (attempt.status === AttemptStatus.Succeeded) return;
    // Cancelled with its task, or already moved on.
    if (node.status !== NodeStatus.Running && node.status !== NodeStatus.WaitingInput) return;
    if (attempt.status === AttemptStatus.Interrupted) interrupt(node);
    else fail(node, NodeEvent.AttemptFailed, feedbackFromAttempt(attempt.status, attempt.error));
  }

  attempts.onSignal(({ type, attempt }) => {
    if (attempt.kind !== AttemptKind.Execute || attempt.nodeId === null) return;
    const node = get(attempt.nodeId);
    if (type === 'awaiting_input' && node.status === NodeStatus.Running) move(node, NodeEvent.InputRequested);
    else if (type === 'input_answered' && node.status === NodeStatus.WaitingInput) move(node, NodeEvent.InputAnswered);
    else if (type === 'ended') onAttemptEnded(node, attempt);
  });

  /**
   * The failing command check a failed step stopped on, when its last attempt submitted a result (D116): null when the
   * step failed in its attempt or on another kind of check.
   */
  function failedCommand(node: Node): CommandCheckResult | null {
    if (node.status !== NodeStatus.Failed) return null;
    const last = attempts.listByNode(node.id).findLast((a) => a.kind === AttemptKind.Execute);
    if (last?.status !== AttemptStatus.Succeeded) return null;
    const failed = node.checkResults?.find((r) => !r.passed);
    return failed?.kind === AcceptanceCheckKind.Command ? failed : null;
  }

  /** Work started by a call that does not wait for it; an unexpected failure is logged with the node. */
  const inBackground = (nodeId: string, work: () => Promise<void>): void => {
    work().catch((err: unknown) => log.error({ err, nodeId }, 'node background work failed'));
  };

  return {
    /** Starts the node's execute attempt; the node is running before this returns (the scheduler counts on it). */
    dispatch(nodeId: string, ctx: NodeRunContext): void {
      const node = get(nodeId);
      const role = roles.get(node.roleId);
      move(node, NodeEvent.Dispatch, undefined, {
        attemptCount: node.attemptCount + 1,
        startedAt: clock.now(),
        finishedAt: null,
      });
      const prompt = renderTemplate(prompts[PromptName.StartExecute], {
        taskKey: ctx.taskKey,
        taskTitle: ctx.taskTitle,
        requirement: ctx.requirement,
        nodeTitle: node.title,
        instructions: node.instructions,
        retryFeedback: node.retryFeedback ?? EMPTY_SECTION,
        uncertaintyRule: prompts[ctx.askOnUncertainty ? PromptName.RuleAsk : PromptName.RuleAssume],
      });
      const start = attempts.start({
        kind: AttemptKind.Execute,
        taskId: ctx.taskId,
        projectId: ctx.projectId,
        nodeId,
        roleId: role.id,
        agent: role.baseAgent,
        directory: ctx.directory,
        title: `${ctx.taskKey} · ${node.title}`,
        model: role.model ?? settings.get('ai.defaultModel'),
        system: role.prompt,
        prompt,
        // A step of a read-only role (the code review's reviewer) may run the project check like a review (D51).
        checkCommands: ctx.checkCommand === null ? [] : [ctx.checkCommand],
      });
      inBackground(nodeId, async () => {
        try {
          await start;
        } catch (err) {
          // The runtime went away between the scheduler's check and the start: dispatch again when it is back.
          if (!(err instanceof AppError && err.code === ErrorCode.OpencodeNotReady)) throw err;
          const current = get(nodeId);
          if (current.status === NodeStatus.Running) interrupt(current);
        }
      });
    },

    /** `submit_result` (12 §6.5): records the result and moves the node to acceptance. */
    async submitResult(attempt: AttemptDTO, input: SubmitResultInput, ctx: NodeRunContext): Promise<ResultNext> {
      if (attempt.nodeId === null) throw new Error(`Execute attempt ${attempt.id} has no node`);
      const node = get(attempt.nodeId);
      const { checks, manual } = node.acceptance;
      const target =
        checks.length > 0 ? NodeStatus.Verifying : manual ? NodeStatus.AwaitingAcceptance : NodeStatus.Done;
      transition(nodeMachine, node.status, NodeEvent.ResultSubmitted, target);
      // Commit before the node counts as done, so a dependent node never starts before the commit.
      const sha = target === NodeStatus.Done ? await commit(node, ctx) : null;
      unit.transact(() => {
        attempts.markSubmitted(attempt.id);
        const current = get(node.id);
        move(current, NodeEvent.ResultSubmitted, target, {
          result: input,
          ...(target === NodeStatus.Done ? doneChanges(sha) : {}),
        });
        if (target === NodeStatus.AwaitingAcceptance) requestAcceptance(current);
      });
      if (target === NodeStatus.Verifying) inBackground(node.id, () => verify(node.id, ctx));
      return target;
    },

    /** Manual acceptance passed (09 §3). */
    async accept(nodeId: string, ctx: NodeRunContext): Promise<Node> {
      const node = get(nodeId);
      transition(nodeMachine, node.status, NodeEvent.Accept);
      const sha = await commit(node, ctx);
      return unit.transact(() => {
        const accepted = move(get(nodeId), NodeEvent.Accept, NodeStatus.Done, doneChanges(sha));
        inbox.resolveOpen({ nodeId, kind: InboxKind.Acceptance }, { accepted: true });
        return accepted;
      });
    },

    /** Manual acceptance rejected: another attempt with the user's feedback, outside the budget (09 §3). */
    reject(nodeId: string, feedback: string): Node {
      return unit.transact(() => {
        const rejected = move(get(nodeId), NodeEvent.Reject, NodeStatus.Ready, {
          retryFeedback: feedbackFromRejection(feedback),
        });
        inbox.resolveOpen({ nodeId, kind: InboxKind.Acceptance }, { accepted: false, feedback });
        return rejected;
      });
    },

    /** User retry of a failed node: a fresh budget (09 §3). */
    retry(nodeId: string, feedback?: string): Node {
      const node = get(nodeId);
      return move(node, NodeEvent.Retry, NodeStatus.Ready, {
        attemptCount: 0,
        retryFeedback: feedback === undefined ? node.retryFeedback : feedbackFromRejection(feedback),
        finishedAt: null,
      });
    },

    /**
     * The checks run again on the step's submitted result, with a fresh budget and without another attempt (D116).
     * Verification starts once the surrounding transaction commits.
     */
    recheck(nodeId: string, ctx: NodeRunContext): Node {
      const node = move(get(nodeId), NodeEvent.Recheck, NodeStatus.Verifying, { attemptCount: 1, finishedAt: null });
      unit.afterCommit(() => inBackground(nodeId, () => verify(nodeId, ctx)));
      return node;
    },

    failedCommand,

    /** The check command a failed step stopped on because the environment could not run it (D116). */
    unrunnableCheck(node: Node): UnrunnableCheck | null {
      const check = failedCommand(node);
      if (check === null || check.unrunnable === null) return null;
      return { command: check.command, ...check.unrunnable };
    },

    stopVerification(nodeId: string): void {
      verifications.get(nodeId)?.abort();
    },

    /**
     * Startup, after attempts were recovered: a node still running or verifying lost its work with the previous run
     * and starts over; one waiting for an answer keeps waiting (09 §3).
     */
    recover(): void {
      for (const node of repo.listByStatus([NodeStatus.Running, NodeStatus.WaitingInput, NodeStatus.Verifying])) {
        const working = attempts
          .listByNode(node.id)
          .some((a) => a.kind === AttemptKind.Execute && a.status === AttemptStatus.Running);
        if (node.status === NodeStatus.Verifying || !working) interrupt(node);
      }
    },
  };
}
