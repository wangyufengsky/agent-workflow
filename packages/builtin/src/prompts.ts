import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Prompt files in `packages/builtin/prompts` (13), by name without `.md`. */
export const PromptName = {
  ProtocolPlan: 'protocol-plan',
  ProtocolExecute: 'protocol-execute',
  ProtocolReview: 'protocol-review',
  StartPlan: 'start-plan',
  StartExecute: 'start-execute',
  StartReview: 'start-review',
  StartAnswer: 'start-answer',
  Replan: 'replan',
  Nudge: 'nudge',
  Revise: 'revise',
  ReviseConflict: 'revise-conflict',
  /** How to handle uncertainty when the task's `ask_on_uncertainty` checkpoint is on / off. */
  RuleAsk: 'rule-ask',
  RuleAssume: 'rule-assume',
} as const;
export type PromptName = (typeof PromptName)[keyof typeof PromptName];

export type Prompts = Readonly<Record<PromptName, string>>;

/** Filled into a template section that has nothing to say (e.g. no feedback yet), so every section keeps its heading. */
export const EMPTY_SECTION = 'None.';

const readPrompt = (dir: string, file: string) => readFileSync(join(dir, `${file}.md`), 'utf8');

/** Reads every prompt once at startup, so a missing file fails the boot instead of a session. */
export function loadPrompts(dir: string): Prompts {
  const read = (name: PromptName) => readPrompt(dir, name);
  return {
    [PromptName.ProtocolPlan]: read(PromptName.ProtocolPlan),
    [PromptName.ProtocolExecute]: read(PromptName.ProtocolExecute),
    [PromptName.ProtocolReview]: read(PromptName.ProtocolReview),
    [PromptName.StartPlan]: read(PromptName.StartPlan),
    [PromptName.StartExecute]: read(PromptName.StartExecute),
    [PromptName.StartReview]: read(PromptName.StartReview),
    [PromptName.StartAnswer]: read(PromptName.StartAnswer),
    [PromptName.Replan]: read(PromptName.Replan),
    [PromptName.Nudge]: read(PromptName.Nudge),
    [PromptName.Revise]: read(PromptName.Revise),
    [PromptName.ReviseConflict]: read(PromptName.ReviseConflict),
    [PromptName.RuleAsk]: read(PromptName.RuleAsk),
    [PromptName.RuleAssume]: read(PromptName.RuleAssume),
  };
}

/** Role prompts (`prompts/roles/<key>.md`) and planner guidance of AI-planned workflows (`prompts/workflows/<key>.md`). */
export const readRolePrompt = (dir: string, key: string) => readPrompt(join(dir, 'roles'), key);
export const readWorkflowGuidance = (dir: string, key: string) => readPrompt(join(dir, 'workflows'), key);

/** Fills `{{name}}` placeholders (13: Mustache style, no logic); every placeholder must be given a value. */
export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template variable {{${name}}} has no value`);
    return value;
  });
}
