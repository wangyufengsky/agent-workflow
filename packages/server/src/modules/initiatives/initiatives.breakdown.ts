import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  INITIATIVE_ITEMS_MAX,
  INITIATIVE_PHASES_MAX,
  type InitiativeDraft,
  type InitiativePhase,
  RequirementVerification,
  type SubmitBreakdownInput,
  type WorkflowSummaryDTO,
} from '@aw/shared';
import type { DoneItem } from './initiatives.background.ts';

/** The AI's breakdown as a draft (34 §8.2): phases keep the gates already set (AI phases never open by themselves). */
export function draftOf(input: SubmitBreakdownInput, current: readonly InitiativePhase[]): InitiativeDraft {
  return {
    phases: input.phases.map((p, i) => ({ title: p.title, goal: p.goal, autoOpen: current[i]?.autoOpen ?? false })),
    items: input.items.map((item) => ({
      key: item.key,
      title: item.title,
      phase: item.phase,
      workflow: item.workflow,
      requirement: item.requirement,
      dependsOn: item.depends_on,
      acceptance: item.acceptance.map((a) => ({
        title: a.title,
        expected: a.expected,
        required: true,
        verification:
          a.command === undefined
            ? { kind: RequirementVerification.AiReview }
            : { kind: RequirementVerification.Command, command: a.command },
      })),
    })),
  };
}

const describeWorkflow = (w: WorkflowSummaryDTO) =>
  `- \`${w.key}\` ${w.name}: ${w.description} (${w.planning === 'ai' ? 'planned by AI' : 'fixed steps'}, ${w.deliverable === 'report' ? 'a report, no code' : 'code changes'})`;

/** The first message of an initiative's breakdown session (34 §8.1). */
export function startMessage(
  prompts: Prompts,
  input: {
    projectName: string;
    baseBranch: string;
    requirement: string;
    attachments: string;
    workflows: readonly WorkflowSummaryDTO[];
  },
): string {
  return renderTemplate(prompts[PromptName.StartBreakdown], {
    projectName: input.projectName,
    baseBranch: input.baseBranch,
    requirement: input.requirement,
    attachments: input.attachments === '' ? '' : `\n${input.attachments}`,
    workflows: input.workflows.map(describeWorkflow).join('\n'),
    maxPhases: String(INITIATIVE_PHASES_MAX),
    maxItems: String(INITIATIVE_ITEMS_MAX),
  });
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** A new breakdown with the user's feedback on the draft (34 §5.2). */
export const rebreakdownStep = (prompts: Prompts, draft: InitiativeDraft, instruction: string | null) =>
  renderTemplate(prompts[PromptName.Rebreakdown], {
    instruction: instruction ?? 'No particular feedback: break it down again, better.',
    draft: json(draft),
  });

export type RefineItem = InitiativeDraft['items'][number] & { state: 'started' | 'done' | 'dropped' | 'open' };

/** Rewrites the work packages not started on the merged code (34 §8.4, D136). */
export function refineStep(
  prompts: Prompts,
  input: {
    baseBranch: string;
    phases: readonly InitiativePhase[];
    items: readonly RefineItem[];
    done: readonly DoneItem[];
    openedPhase: number;
    instruction: string | null;
  },
): string {
  const done = input.done.map((d) => ({
    key: d.key,
    title: d.title,
    ...(d.dropReason === null
      ? { merged: d.merged, changedFiles: d.files, result: d.summary }
      : { dropped: d.dropReason }),
  }));
  return renderTemplate(prompts[PromptName.RefineBreakdown], {
    baseBranch: input.baseBranch,
    done: done.length === 0 ? 'Nothing yet.' : json(done),
    draft: json({ phases: input.phases.map(({ title, goal }) => ({ title, goal })), items: input.items }),
    instruction: input.instruction === null ? '' : `\nThe user adds:\n\n${input.instruction}\n`,
    openedPhase: String(input.openedPhase),
  });
}
