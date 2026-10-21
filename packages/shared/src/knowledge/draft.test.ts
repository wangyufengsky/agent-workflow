import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '../contracts/api/attempts.ts';
import { TranscriptEntryKind } from '../enums/system.ts';
import { answerDraft } from './draft.ts';

let seq = 0;
const text = (t: string): TranscriptEntry => ({
  seq: ++seq,
  ts: 0,
  partId: `p${seq}`,
  kind: TranscriptEntryKind.Text,
  data: { text: t },
});
const call = (tool: string): TranscriptEntry => ({
  seq: ++seq,
  ts: 0,
  kind: TranscriptEntryKind.ToolCall,
  data: { tool, callId: `c${seq}`, input: {} },
});

describe('answerDraft', () => {
  it('还没写正文时没有草稿', () => {
    expect(answerDraft([call('grep')])).toBeUndefined();
  });

  it('工具调用之间的说明不算草稿，最后一个工具调用之后的正文才是', () => {
    expect(answerDraft([text('Let me look.'), call('read'), text('It is rounded [1].')])).toBe('It is rounded [1].');
  });

  it('提交回答不截断草稿：提交之后的正文也接在后面', () => {
    const entries = [call('read'), text('Rounded [1].'), call('agent-workflow_submit_answer'), text('Done.')];
    expect(answerDraft(entries)).toBe('Rounded [1].\n\nDone.');
  });
});
