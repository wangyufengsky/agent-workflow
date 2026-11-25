import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BuiltinDesignTemplateKey } from '@aw/builtin';
import { DESIGN_SCAN_MAX_FILE_BYTES } from '@aw/shared';
import { expect, it } from 'vitest';
import { backendCommitter, runGit } from '../git/index.ts';
import { inspectDesignProject } from './designs.features.ts';
import { scanDesignProject } from './designs.scanner.ts';

async function write(root: string, path: string, contents: string | Buffer) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
}

it('扫描非 Git 目录，先排除依赖、敏感文件、符号链接与用户指定文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-scan-'));
  const outside = await mkdtemp(join(tmpdir(), 'design-outside-'));
  const source = 'export const orders = [];\n';
  await Promise.all([
    write(root, 'src/orders.ts', source),
    write(root, 'src/generated/ignored.ts', 'generated'),
    write(root, 'node_modules/ignored.ts', 'dependency'),
    write(root, 'node_modules/nested/ignored.ts', 'another dependency'),
    write(root, '.env', 'private'),
    write(root, 'package.json', '{not valid JSON'),
    write(root, '.env.example', 'MODE=test'),
    write(root, 'src/large.ts', Buffer.alloc(DESIGN_SCAN_MAX_FILE_BYTES + 1, 'a')),
    write(root, 'src/data.txt', Buffer.from([0, 0xff])),
    write(outside, 'foreign.ts', 'outside'),
  ]);
  await Promise.all([
    symlink(join(outside, 'foreign.ts'), join(root, 'src', 'escape.ts'), 'file'),
    symlink(join(root, '.env'), join(root, 'src', 'alias.ts'), 'file'),
  ]);

  const result = await scanDesignProject(root, ['**/generated', 'package.json'], 100);
  expect(result.files.map((file) => file.relPath)).toEqual(['.env.example', 'src/orders.ts']);
  expect(result.files).toContainEqual({
    relPath: 'src/orders.ts',
    contentHash: createHash('sha256').update(source).digest('hex'),
  });
  expect(result.snapshot).toMatchObject({
    branch: null,
    commitSha: null,
    dirty: false,
    scannedAt: 100,
    analyzableCount: 2,
    skippedCount: 8,
    skippedReasons: { binary: 1, dependencyOrBuild: 1, oversize: 1, pattern: 2, sensitive: 1, symlink: 2 },
  });
});

it('记录真实 Git 基线，同时扫描工作区中尚未跟踪的源码', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-git-'));
  const git = (...args: string[]) => runGit(args, { cwd: root });
  await git('init', '-b', 'main');
  await write(root, 'src/tracked.ts', 'export const tracked = true;\n');
  await git('add', '.');
  await git(...backendCommitter(), 'commit', '-m', 'Fixture');
  const { stdout: commitSha } = await git('rev-parse', 'HEAD');
  const clean = await scanDesignProject(root, [], 100);
  expect(clean.snapshot).toMatchObject({ branch: 'main', commitSha: commitSha.trim(), dirty: false });
  await write(root, 'src/untracked.ts', 'export const untracked = true;\n');
  const dirty = await scanDesignProject(root, [], 200);
  expect(dirty.snapshot).toMatchObject({ branch: 'main', commitSha: commitSha.trim(), dirty: true });
  expect(dirty.files.map((file) => file.relPath)).toEqual(['src/tracked.ts', 'src/untracked.ts']);
});

it('轻量推荐根据根目录识别框架，忽略深层标记和外部清单链接', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-recommend-'));
  const outside = await mkdtemp(join(tmpdir(), 'design-recommend-outside-'));
  await Promise.all([
    write(root, 'src/packages/agents/pom.xml', 'nested'),
    write(root, 'src/web/package.json', '{"dependencies":{"react":"*"}}'),
    write(outside, 'package.json', '{"dependencies":{"@openai/agents":"*"}}'),
  ]);
  await symlink(join(outside, 'package.json'), join(root, 'package.json'), 'file');
  await expect(inspectDesignProject(root)).resolves.toEqual({
    recommendedTemplateKey: BuiltinDesignTemplateKey.General,
    techStack: [],
  });

  const web = await mkdtemp(join(tmpdir(), 'design-recommend-web-'));
  await write(web, 'package.json', '{"dependencies":{"react":"*"},"devDependencies":{"typescript":"*"}}');
  await expect(inspectDesignProject(web)).resolves.toEqual({
    recommendedTemplateKey: BuiltinDesignTemplateKey.General,
    techStack: ['JavaScript', 'TypeScript', 'React'],
  });
});
