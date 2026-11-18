import type { TranscriptEntry } from '@aw/shared';
import { expect, it } from 'vitest';
import { projectReadPath, readRequest } from './project-file-read.ts';
import { reviewReads } from './review-reading.ts';

it('识别带范围的单文件读取，保留阅读位置', () => {
  expect(readRequest('bash', { command: "sed -n '4,8p' 'docs/开发 约定.md'", workdir: '/repo' })).toMatchObject({
    path: 'docs/开发 约定.md',
    location: '第 4–8 行',
    directory: '/repo',
  });
  expect(readRequest('bash', { command: 'cat -- README.md' })?.path).toBe('README.md');
  for (const command of ['node probe.js', 'cat a b', 'cat x | sh', 'cat "$(pwd)/file"', 'cat x; cat y'])
    expect(readRequest('bash', { command })).toBeUndefined();
});
it('仅从项目本身或本次工作区解释文件位置，兼容子目录与 Windows', () => {
  expect(projectReadPath('../README.md', '/repo/docs', ['/repo'])).toBe('README.md');
  expect(projectReadPath('/repo-other/x', '/repo', ['/repo'])).toBeUndefined();
  expect(projectReadPath('../../outside', '/repo/docs', ['/repo'])).toBeUndefined();
  expect(projectReadPath('c:\\Work\\App\\src\\a.ts', '', ['C:\\work\\app'])).toBe('src/a.ts');
});

it('审查阅读保留成功读取的位置，跳过失败调用和工作区外的文件', () => {
  const entries: TranscriptEntry[] = [];
  function read(filePath: string, offset: number, status: 'completed' | 'error') {
    const seq = entries.length + 1;
    const callId = String(seq);
    entries.push(
      { seq, ts: seq, kind: 'tool_call', data: { tool: 'read', callId, input: { filePath, offset, limit: 3 } } },
      { seq: seq + 1, ts: seq + 1, kind: 'tool_result', data: { tool: 'read', callId, status } },
    );
  }
  read('a.ts', 6, 'completed');
  read('b.ts', 7, 'completed');
  read('a.ts', 10, 'completed');
  read('../outside.ts', 2, 'completed');
  read('c.ts', 40, 'error');
  expect(reviewReads(entries, '/repo', ['/repo'], 'abc123')).toEqual([
    { commit: 'abc123', path: 'b.ts', line: 7, end: 9 },
    { commit: 'abc123', path: 'a.ts', line: 10, end: 12 },
  ]);
});
