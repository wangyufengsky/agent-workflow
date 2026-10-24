import { type Prompts, renderTemplate, VERIFY_NODE } from '@aw/builtin';
import {
  type AcceptanceCheck,
  AcceptanceCheckKind,
  AppError,
  ErrorCode,
  NodeKind,
  type PlanGraph,
  type PlanNodeSpec,
  RequirementConclusion,
  RequirementResultSource,
  RequirementVerification,
  type SubmitResultInput,
} from '@aw/shared';
import type { Node } from '../nodes/index.ts';
import type { NewRequirementResult, RequirementsService } from '../requirements/index.ts';

/** Nodes nothing else depends on: a step appended after them comes last (13 §4). */
export const leafKeys = (nodes: ReadonlyArray<{ key: string; dependsOn: readonly string[] }>) =>
  nodes.filter((n) => !nodes.some((other) => other.dependsOn.includes(n.key))).map((n) => n.key);

/**
 * The verify step of a task with an acceptance checklist (31 §2.2): built from the checklist's current version, run
 * by a read-only reviewer, its command checks tied to their items; its conclusions recorded when it is done.
 */
export function createVerifySteps({ requirements, prompts }: { requirements: RequirementsService; prompts: Prompts }) {
  function spec(taskId: string, key: string, dependsOn: readonly string[]): PlanNodeSpec | undefined {
    const current = requirements.current(taskId);
    if (current === undefined) return undefined;
    const items = current.items
      .map(
        (item) =>
          `- \`${item.id}\` (${item.verification.kind}${item.required ? ', required' : ''}): ${item.title}\n  Expected: ${item.expected}`,
      )
      .join('\n');
    const checks: AcceptanceCheck[] = current.items.flatMap((item) =>
      item.verification.kind === RequirementVerification.Command
        ? [{ kind: AcceptanceCheckKind.Command, command: item.verification.command, requirementItemId: item.id }]
        : [],
    );
    return {
      key,
      title: VERIFY_NODE.title,
      roleKey: VERIFY_NODE.roleKey,
      instructions: renderTemplate(prompts[VERIFY_NODE.prompt], { items }),
      dependsOn: [...dependsOn],
      acceptance: { checks, manual: false },
      kind: NodeKind.Verify,
    };
  }

  return {
    /**
     * The plan graph with its verify step: appended after every other step when the task has a checklist, or
     * brought up to date with the checklist when it is there already (the checklist may change until the plan runs).
     */
    withVerifyStep(taskId: string, graph: PlanGraph): PlanGraph {
      if (!graph.nodes.some((n) => n.kind === NodeKind.Verify)) {
        const step = spec(taskId, VERIFY_NODE.keyPrefix, leafKeys(graph.nodes));
        return step === undefined ? graph : { nodes: [...graph.nodes, step] };
      }
      return {
        nodes: graph.nodes.map((n) => (n.kind === NodeKind.Verify ? (spec(taskId, n.key, n.dependsOn) ?? n) : n)),
      };
    },

    /** A verify step after the steps `after` (a change asked for, 31 §2.3); undefined without a checklist. */
    stepAfter: (taskId: string, key: string, after: readonly string[]) => spec(taskId, key, after),

    /**
     * `submit_result.requirement_results` (12 §9): only the verify step gives them, each for an AI-verified item of
     * the current version, once. Items it leaves out stay unverified.
     */
    checkResults(taskId: string, node: Node, results: SubmitResultInput['requirement_results']): void {
      if (results === undefined) return;
      const invalid = (message: string, details: Record<string, unknown> = {}) =>
        new AppError(ErrorCode.RequirementResultsInvalid, message, details);
      if (node.kind !== NodeKind.Verify) throw invalid('Only the step 核验验收清单 gives requirement_results');
      const items = new Map((requirements.current(taskId)?.items ?? []).map((item) => [item.id, item]));
      const seen = new Set<string>();
      for (const { item_id } of results) {
        const item = items.get(item_id);
        if (item === undefined) throw invalid(`No item ${item_id} in the checklist`, { item_id });
        if (item.verification.kind !== RequirementVerification.AiReview) {
          throw invalid(`Item ${item_id} is verified by ${item.verification.kind}, not by you`, { item_id });
        }
        if (seen.has(item_id)) throw invalid(`Item ${item_id} is given twice`, { item_id });
        seen.add(item_id);
      }
    },

    /** The conclusions of a finished verify step (31 §2.2), recorded in its finishing transaction. */
    record(node: Node, commitSha: string): void {
      const base = { nodeId: node.id, commitSha };
      const fromAi: NewRequirementResult[] = (node.result?.requirement_results ?? []).map((r) => ({
        ...base,
        itemId: r.item_id,
        source: RequirementResultSource.Ai,
        conclusion: r.conclusion,
        note: r.note,
        output: null,
      }));
      // A verify step runs every check in order, so its results line up with its checks.
      const fromCommands = node.acceptance.checks.flatMap((check, i): NewRequirementResult[] => {
        const result = node.checkResults?.[i];
        if (check.kind !== AcceptanceCheckKind.Command || check.requirementItemId === undefined) return [];
        if (result?.kind !== AcceptanceCheckKind.Command) return [];
        const ran = !result.skipped && result.unrunnable === null;
        return [
          {
            ...base,
            itemId: check.requirementItemId,
            source: RequirementResultSource.Command,
            conclusion: !ran
              ? RequirementConclusion.Unverified
              : result.passed
                ? RequirementConclusion.Pass
                : RequirementConclusion.Fail,
            note: '',
            output: result.output,
          },
        ];
      });
      requirements.record(node.taskId, [...fromAi, ...fromCommands]);
    },
  };
}
export type VerifySteps = ReturnType<typeof createVerifySteps>;
