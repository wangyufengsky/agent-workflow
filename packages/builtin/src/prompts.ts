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
  /** Review comments of the task's pull request to address (21 §3.1). */
  ReviseReview: 'revise-review',
  /** How to handle uncertainty when the task's `ask_on_uncertainty` checkpoint is on / off. */
  RuleAsk: 'rule-ask',
  RuleAssume: 'rule-assume',
  /** The app assistant's agent prompt and its per-turn messages (15). */
  ProtocolAssistant: 'protocol-assistant',
  ProtocolCompanion: 'protocol-companion',
  AssistantContext: 'assistant-context',
  AssistantConfirmed: 'assistant-confirmed',
  AssistantCancelled: 'assistant-cancelled',
  AssistantTaskUpdated: 'assistant-task-updated',
  /** The outcome of a knowledge question the assistant asked, sent to its session (18 §4a). */
  AssistantKnowledgeAnswered: 'assistant-knowledge-answered',
  AssistantKnowledgeFailed: 'assistant-knowledge-failed',
  /** A member analysis the assistant started has ended (33 §6). */
  AssistantTeamAnalysis: 'assistant-team-analysis',
  /** The knowledge researcher's agent prompt, its first message and a follow-up question (18 §5). */
  ProtocolResearch: 'protocol-research',
  StartResearch: 'start-research',
  ResearchFollowUp: 'research-followup',
  /** The PPT writer's agent prompt, the first message's context and the message of each kind of work (23 §7). */
  ProtocolSlides: 'protocol-slides',
  DeckContext: 'deck-context',
  DeckOutline: 'deck-outline',
  DeckOutlineRevise: 'deck-outline-revise',
  DeckSlides: 'deck-slides',
  DeckSlidesRevise: 'deck-slides-revise',
  /** The Git workbench's reviewer: its agent prompt, a review's and a commit message draft's first message (27 §4). */
  ProtocolCodeReview: 'protocol-code-review',
  StartGitReview: 'start-git-review',
  StartCommitMessage: 'start-commit-message',
  /** The same reviewer summarising one member's work for the team page (33 §6.3). */
  StartTeamAnalysis: 'start-team-analysis',
  /** The same reviewer breaking a requirement into an initiative's work packages, and refining them (34 §8). */
  StartBreakdown: 'start-breakdown',
  Rebreakdown: 'rebreakdown',
  RefineBreakdown: 'refine-breakdown',
  /** The files the user attached to a task or an assistant message, as the model reads them (30 §3.2). */
  Attachments: 'attachments',
  /** The instructions of the verify step (31 §2.2). */
  VerifyRequirements: 'verify-requirements',
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
    [PromptName.ReviseReview]: read(PromptName.ReviseReview),
    [PromptName.RuleAsk]: read(PromptName.RuleAsk),
    [PromptName.RuleAssume]: read(PromptName.RuleAssume),
    [PromptName.ProtocolAssistant]: read(PromptName.ProtocolAssistant),
    [PromptName.ProtocolCompanion]: read(PromptName.ProtocolCompanion),
    [PromptName.AssistantContext]: read(PromptName.AssistantContext),
    [PromptName.AssistantConfirmed]: read(PromptName.AssistantConfirmed),
    [PromptName.AssistantCancelled]: read(PromptName.AssistantCancelled),
    [PromptName.AssistantTaskUpdated]: read(PromptName.AssistantTaskUpdated),
    [PromptName.AssistantKnowledgeAnswered]: read(PromptName.AssistantKnowledgeAnswered),
    [PromptName.AssistantKnowledgeFailed]: read(PromptName.AssistantKnowledgeFailed),
    [PromptName.AssistantTeamAnalysis]: read(PromptName.AssistantTeamAnalysis),
    [PromptName.ProtocolResearch]: read(PromptName.ProtocolResearch),
    [PromptName.StartResearch]: read(PromptName.StartResearch),
    [PromptName.ResearchFollowUp]: read(PromptName.ResearchFollowUp),
    [PromptName.ProtocolSlides]: read(PromptName.ProtocolSlides),
    [PromptName.DeckContext]: read(PromptName.DeckContext),
    [PromptName.DeckOutline]: read(PromptName.DeckOutline),
    [PromptName.DeckOutlineRevise]: read(PromptName.DeckOutlineRevise),
    [PromptName.DeckSlides]: read(PromptName.DeckSlides),
    [PromptName.DeckSlidesRevise]: read(PromptName.DeckSlidesRevise),
    [PromptName.ProtocolCodeReview]: read(PromptName.ProtocolCodeReview),
    [PromptName.StartGitReview]: read(PromptName.StartGitReview),
    [PromptName.StartCommitMessage]: read(PromptName.StartCommitMessage),
    [PromptName.StartTeamAnalysis]: read(PromptName.StartTeamAnalysis),
    [PromptName.StartBreakdown]: read(PromptName.StartBreakdown),
    [PromptName.Rebreakdown]: read(PromptName.Rebreakdown),
    [PromptName.RefineBreakdown]: read(PromptName.RefineBreakdown),
    [PromptName.Attachments]: read(PromptName.Attachments),
    [PromptName.VerifyRequirements]: read(PromptName.VerifyRequirements),
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
