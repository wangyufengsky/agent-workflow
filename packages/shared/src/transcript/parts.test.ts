import { describe, expect, it } from 'vitest';
import { mergePiece, pieceBetween } from './parts.ts';

const apply = (full: string, p: { text: string; offset: number }) => full.slice(0, p.offset) + p.text;

describe('text pieces (D104)', () => {
  it('merging consecutive pieces equals applying them one by one', () => {
    const a = pieceBetween('', 'The export');
    const b = pieceBetween('The export', 'The export drops');
    const c = { offset: 4, text: 'csv drops the row' };
    const stepwise = apply(apply(apply('', a), b), c);
    expect(stepwise).toBe('The csv drops the row');
    expect(apply('', mergePiece(mergePiece(a, b), c))).toBe(stepwise);
    // A page that starts mid-part merges its own lines and is applied to what came before.
    expect(apply(apply('', a), mergePiece(b, c))).toBe(stepwise);
  });

  it('a whole-text line written before D104 replaces the text', () => {
    expect(apply('partial', { offset: 0, text: 'whole text' })).toBe('whole text');
  });

  it('the closing text may differ from what was streamed: only the changed tail is written', () => {
    expect(pieceBetween('Hello wrld', 'Hello world.')).toEqual({ offset: 7, text: 'orld.' });
    expect(pieceBetween('Hello world  ', 'Hello world')).toEqual({ offset: 11, text: '' });
  });
});
