import { type Acceptance, AcceptanceCheckKind, ChangeRequestReason, PROJECT_CHECK_PLACEHOLDER } from '@aw/shared';
import { PromptName } from './prompts.ts';
import { BuiltinRoleKey } from './roles.ts';

/** A node the system appends when the user sends a task back to the AI (13 §4): from review, or review comments (21). */
export type SystemNode = {
  /** Keys are `<keyPrefix><n>`, n counting the task's earlier nodes of the kind from 1. */
  keyPrefix: string;
  title: string;
  roleKey: string;
  prompt: PromptName;
  acceptance: Acceptance;
};

const checked: Acceptance = {
  checks: [{ kind: AcceptanceCheckKind.Command, command: PROJECT_CHECK_PLACEHOLDER }],
  manual: false,
};

export const SYSTEM_NODES: Readonly<Record<ChangeRequestReason, SystemNode>> = {
  [ChangeRequestReason.User]: {
    keyPrefix: 'revise_',
    title: '按反馈修改',
    roleKey: BuiltinRoleKey.Developer,
    prompt: PromptName.Revise,
    acceptance: checked,
  },
  [ChangeRequestReason.Conflict]: {
    keyPrefix: 'resolve_conflict_',
    title: '解决合并冲突',
    roleKey: BuiltinRoleKey.Developer,
    prompt: PromptName.ReviseConflict,
    acceptance: checked,
  },
  [ChangeRequestReason.Review]: {
    keyPrefix: 'review_fix_',
    title: '按审查意见修改',
    roleKey: BuiltinRoleKey.Developer,
    prompt: PromptName.ReviseReview,
    acceptance: checked,
  },
};
