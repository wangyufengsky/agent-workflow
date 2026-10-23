import { type AssistantConfirmationDTO, AssistantConfirmationStatus, type AssistantConversationDTO } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { panelFollowsUser } from './handoff.ts';

const conversation = (busy: boolean): AssistantConversationDTO => ({
  id: 'c1',
  title: '',
  busy,
  pendingPermissions: [],
  createdAt: 0,
  updatedAt: 0,
  usage: { latest: null, recordedFrom: null, turns: 0, unknownTurns: 0, tokensInput: null, tokensOutput: null },
});
const confirmation = (status: AssistantConfirmationStatus) => ({ id: 'k', status }) as AssistantConfirmationDTO;

describe('用户自己离开主页时面板是否接着显示对话（D112）', () => {
  it('助手还在回复或有等待确认的卡片时接着显示', () => {
    expect(panelFollowsUser(conversation(true), [])).toBe(true);
    expect(panelFollowsUser(conversation(false), [confirmation(AssistantConfirmationStatus.Pending)])).toBe(true);
  });

  it('对话已经结束、确认都处理过时不打开', () => {
    expect(panelFollowsUser(conversation(false), [confirmation(AssistantConfirmationStatus.Confirmed)])).toBe(false);
    expect(panelFollowsUser(conversation(false), undefined)).toBe(false);
    expect(panelFollowsUser(undefined, undefined)).toBe(false);
  });
});
