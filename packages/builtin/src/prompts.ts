import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Prompt files in `packages/builtin/prompts` (13), by name without `.md`. */
export const PromptName = {
  ProtocolPlan: 'protocol-plan',
  ProtocolExecute: 'protocol-execute',
  ProtocolReview: 'protocol-review',
  StartExecute: 'start-execute',
  Nudge: 'nudge',
} as const;
export type PromptName = (typeof PromptName)[keyof typeof PromptName];

export type Prompts = Readonly<Record<PromptName, string>>;

/** Reads every prompt once at startup, so a missing file fails the boot instead of a session. */
export function loadPrompts(dir: string): Prompts {
  const read = (name: PromptName) => readFileSync(join(dir, `${name}.md`), 'utf8');
  return {
    [PromptName.ProtocolPlan]: read(PromptName.ProtocolPlan),
    [PromptName.ProtocolExecute]: read(PromptName.ProtocolExecute),
    [PromptName.ProtocolReview]: read(PromptName.ProtocolReview),
    [PromptName.StartExecute]: read(PromptName.StartExecute),
    [PromptName.Nudge]: read(PromptName.Nudge),
  };
}

/** Fills `{{name}}` placeholders (13: Mustache style, no logic); every placeholder must be given a value. */
export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template variable {{${name}}} has no value`);
    return value;
  });
}
