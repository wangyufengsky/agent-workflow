import { TeamWorkType } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { classifyWork, parseTeamLog } from './team.parse.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

/** One record as `git log --format=<TEAM_LOG_FORMAT> --numstat -z` writes it. */
const record = (sha: string, email: string, subject: string, trailers: string, body: string, numstat: string) =>
  `\x1e${sha}\0Zhang San\0${email}\0${1_790_000_000}\0${subject}\0${trailers}\0${body}\0${numstat === '' ? '' : `\0\n${numstat}`}`;

describe('提交日志解析', () => {
  it('作者、时间、文件统计（二进制为空、改名取新路径）与没有改动文件的提交', () => {
    const output =
      record(SHA_A, 'ZS@Example.com', 'feat: one', '', '', '3\t1\tsrc/a.ts\0-\t-\tlogo.png\0') +
      record(SHA_B, 'zs@example.com', 'fix: two', '', '', '1\t0\t\0old.ts\0new.ts\0') +
      record(SHA_C, 'zs@example.com', 'chore: empty', '', '', '');

    const [a, b, c] = parseTeamLog(output);
    expect(a).toMatchObject({
      sha: SHA_A,
      authorEmail: 'zs@example.com',
      authorName: 'Zhang San',
      authoredAt: 1_790_000_000_000,
      aiTask: false,
      files: [
        { path: 'src/a.ts', added: 3, deleted: 1 },
        { path: 'logo.png', added: null, deleted: null },
      ],
    });
    expect(b?.files).toEqual([{ path: 'new.ts', added: 1, deleted: 0 }]);
    expect(c?.files).toEqual([]);
  });

  it('本应用任务的提交、发起人 trailer、其他 AI 工具的 Co-Authored-By、回滚目标', () => {
    const output =
      record(
        SHA_A,
        'agent-workflow@localhost',
        'T-1 改按钮',
        'Agent-Workflow-Requested-By: Li Si <LS@Example.com>\n',
        '',
        '1\t0\ta.ts\0',
      ) +
      record(SHA_B, 'zs@example.com', 'feat: x', 'Co-authored-by: Claude <noreply@anthropic.com>\n', '', '') +
      record(
        SHA_C,
        'zs@example.com',
        `Revert "feat: x"`,
        'Co-authored-by: Wang Wu <ww@example.com>\n',
        `This reverts commit ${SHA_B}.`,
        '',
      );

    const [task, coauthored, revert] = parseTeamLog(output);
    expect(task).toMatchObject({ aiTask: true, requestedBy: { name: 'Li Si', email: 'ls@example.com' } });
    expect(coauthored).toMatchObject({ aiTask: false, aiCoauthor: true, requestedBy: null });
    expect(revert).toMatchObject({ aiCoauthor: false, revertsSha: SHA_B });
  });
});

describe('工作构成分类', () => {
  it.each([
    ['feat(team): add page', TeamWorkType.Feature],
    ['fix!: crash', TeamWorkType.Fix],
    ['perf: faster', TeamWorkType.Refactor],
    ['docs: readme', TeamWorkType.Docs],
    ['ci: cache', TeamWorkType.Chore],
    ['Revert "feat: x"', TeamWorkType.Chore],
    ['修复登录失败', TeamWorkType.Fix],
    ['新增导出按钮', TeamWorkType.Feature],
    ['wip: later', TeamWorkType.Other],
    ['update stuff', TeamWorkType.Other],
  ])('%s → %s', (subject, type) => {
    expect(classifyWork(subject)).toBe(type);
  });
});
