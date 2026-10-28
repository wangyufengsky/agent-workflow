import { describe, expect, it } from 'vitest';
import { parseLog } from './git.log.ts';
import { parseBranches } from './git.refs.ts';
import { parseStatus } from './git.status.ts';
import { parseLsTree } from './git.tree.ts';
import { parseWorktreeList } from './git.worktrees.ts';

// Output samples captured from git 2.45.2 with LC_ALL=C (07 §3.1: parsers are tested on real output).
const SHA_MAIN = '7f6c666873c80ff59f2a04928b97c0d7d938b044';
const SHA_INIT = '04c3e13e97c65a894e2ef263aa04b150e0bfdff0';
const SHA_FEAT = 'e305685250ae08f9e3252b01b4669964cbd6a010';
const BLOB = '422c2b7ab3b3c668038da977e4e93a5fc623169c';

describe('git status --porcelain=v2 --branch -z', () => {
  it('读出分支、上游距离与改动（含重命名的原路径、未跟踪文件）', () => {
    const output =
      `# branch.oid ${SHA_MAIN}\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -0\0` +
      `1 .M N... 100644 100644 100644 ${BLOB} ${BLOB} a.txt\0` +
      `2 R. N... 100644 100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 587be6b4c3f93f93c489c0111bba5596147a26cb R100 src/x2.ts\0src/x.ts\0` +
      '? bin.dat\0? untracked file.txt\0';
    expect(parseStatus(output)).toEqual({
      branch: 'main',
      commit: SHA_MAIN,
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      clean: false,
      files: [
        { path: 'a.txt', code: '.M' },
        { path: 'src/x2.ts', code: 'R.' },
        { path: 'bin.dat', code: '??' },
        { path: 'untracked file.txt', code: '??' },
      ],
    });
  });

  it('合并冲突中的文件为 UU；尚无提交的仓库没有 commit', () => {
    const conflicted = parseStatus(
      `# branch.oid ${SHA_MAIN}\0# branch.head main\0` +
        `u UU N... 100644 100644 100644 100644 ${BLOB} 223b7836fb19fdf64ba2d3cd6173c6a283141f78 f70f10e4db19068f79bc43844b49f3eece45c4e8 a.txt\0`,
    );
    expect(conflicted.files).toEqual([{ path: 'a.txt', code: 'UU' }]);
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({
      branch: 'main',
      commit: null,
      upstream: null,
      clean: true,
    });
  });
});

describe('git for-each-ref', () => {
  it('本地与远端分支、当前分支、上游领先落后；跳过 origin/HEAD 这类符号引用', () => {
    const output =
      ` \0refs/heads/aw/T-1-feat\0${SHA_FEAT}\0\0\x001760000000\0\0feat y\n` +
      `*\0refs/heads/main\0${SHA_MAIN}\0origin/main\0ahead 1, behind 2\x001760000000\0\0second body line 1\n` +
      ` \0refs/heads/other\0${SHA_MAIN}\0origin/other\0gone\x001760000000\0\0second body line 1\n` +
      ` \0refs/remotes/origin/HEAD\0${SHA_INIT}\0\0\x001760000000\0refs/remotes/origin/main\0init\n` +
      ` \0refs/remotes/origin/main\0${SHA_INIT}\0\0\x001760000000\0\0init\n`;
    expect(parseBranches(output)).toEqual([
      {
        name: 'aw/T-1-feat',
        remote: false,
        commit: SHA_FEAT,
        current: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        subject: 'feat y',
        committedAt: 1_760_000_000_000,
      },
      expect.objectContaining({ name: 'main', current: true, upstream: 'origin/main', ahead: 1, behind: 2 }),
      expect.objectContaining({ name: 'other', upstream: 'origin/other', ahead: 0, behind: 0 }),
      expect.objectContaining({ name: 'origin/main', remote: true, commit: SHA_INIT }),
    ]);
  });
});

describe('git log', () => {
  it('多行正文、父提交与根提交', () => {
    const output =
      `${SHA_MAIN}\0${SHA_INIT}\0T\0t@e.com\x001760000000\0second body line 1\0body line 3\n\x1e\n` +
      `${SHA_INIT}\0\0T\0t@e.com\x001760000000\0init\0\x1e\n`;
    expect(parseLog(output)).toEqual([
      {
        sha: SHA_MAIN,
        parents: [SHA_INIT],
        authorName: 'T',
        authorEmail: 't@e.com',
        authoredAt: 1_760_000_000_000,
        subject: 'second body line 1',
        body: 'body line 3',
      },
      expect.objectContaining({ sha: SHA_INIT, parents: [], body: '' }),
    ]);
  });
});

describe('git ls-tree -z --long', () => {
  it('目录在前，子目录的路径从仓库根算起', () => {
    const root = `100644 blob ${BLOB}       4\ta.txt\x00040000 tree 15804abd8ad47351f0f0e5af9ac4c342424372ac       -\tsrc\0`;
    expect(parseLsTree(root, '')).toEqual([
      { name: 'src', path: 'src', type: 'tree', size: null },
      { name: 'a.txt', path: 'a.txt', type: 'blob', size: 4 },
    ]);
    const sub = '100644 blob 587be6b4c3f93f93c489c0111bba5596147a26cb       2\tx.ts\0';
    expect(parseLsTree(sub, 'src')).toEqual([{ name: 'x.ts', path: 'src/x.ts', type: 'blob', size: 2 }]);
  });
});

describe('git worktree list --porcelain（不带 -z，D225）', () => {
  it('主工作区、游离、锁定与目录已不存在的 worktree；路径里的空格、引号与中文原样保留', () => {
    const output =
      `worktree /r/repo\nHEAD ${SHA_MAIN}\nbranch refs/heads/main\n\n` +
      `worktree /r/det\nHEAD ${SHA_INIT}\ndetached\n\n` +
      `worktree /r/locked\nHEAD ${SHA_MAIN}\nbranch refs/heads/other\nlocked in use\n\n` +
      `worktree /r/中文 "q"\nHEAD ${SHA_MAIN}\nbranch refs/heads/feat\n\n` +
      `worktree /r/wt\nHEAD ${SHA_FEAT}\nbranch refs/heads/aw/T-1-feat\nprunable gitdir file points to non-existent location\n\n`;
    expect(parseWorktreeList(output)).toEqual([
      { path: '/r/repo', commit: SHA_MAIN, branch: 'main', locked: false, prunable: false },
      { path: '/r/det', commit: SHA_INIT, branch: null, locked: false, prunable: false },
      { path: '/r/locked', commit: SHA_MAIN, branch: 'other', locked: true, prunable: false },
      { path: '/r/中文 "q"', commit: SHA_MAIN, branch: 'feat', locked: false, prunable: false },
      { path: '/r/wt', commit: SHA_FEAT, branch: 'aw/T-1-feat', locked: false, prunable: true },
    ]);
  });
});
