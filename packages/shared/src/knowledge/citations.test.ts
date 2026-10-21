import { describe, expect, it } from 'vitest';
import { KnowledgeSourceKind } from '../enums/knowledge.ts';
import { citationMarkers, classifySource } from './citations.ts';

const numbers = (answer: string) => citationMarkers(answer).map((m) => m.n);

describe('citationMarkers', () => {
  it('finds markers in order with their positions', () => {
    const answer = 'Rounded in `round()` [1].\nAlso [2][3].';
    expect(citationMarkers(answer)).toEqual([
      { n: 1, start: 21, end: 24 },
      { n: 2, start: 31, end: 34 },
      { n: 3, start: 34, end: 37 },
    ]);
    expect(answer.slice(21, 24)).toBe('[1]');
  });

  it('skips link text, inline code and fenced code', () => {
    const answer = [
      'See [1](https://example.com) and `items[2]` and ``a`[3]`b``.',
      '```ts',
      'const x = arr[4];',
      '```',
      'Done [5].',
    ].join('\n');
    expect(numbers(answer)).toEqual([5]);
  });

  it('keeps counting after a tilde fence that a backtick line does not close', () => {
    expect(numbers('~~~\n```\n[1]\n~~~\n[2]')).toEqual([2]);
  });
});

describe('classifySource', () => {
  it('treats Markdown and text files, and files under docs directories, as documentation', () => {
    expect(classifySource('README.md')).toBe(KnowledgeSourceKind.Docs);
    expect(classifySource('packages/a/docs/example.ts')).toBe(KnowledgeSourceKind.Docs);
    expect(classifySource('NOTES.TXT')).toBe(KnowledgeSourceKind.Docs);
  });

  it('treats everything else as code', () => {
    expect(classifySource('src/refund.ts')).toBe(KnowledgeSourceKind.Code);
    expect(classifySource('docs.ts')).toBe(KnowledgeSourceKind.Code);
  });
});
