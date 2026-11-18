import { expect, it } from 'vitest';
import { projectReadPath, readRequest } from './project-file-read.ts';

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
