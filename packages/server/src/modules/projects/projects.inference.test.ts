import { describe, expect, it } from 'vitest';
import { inferCheckCommand, parseRemoteUrl } from './projects.inference.ts';

describe('parseRemoteUrl', () => {
  it.each([
    ['git@github.com:acme/shop.git', { provider: 'github', baseUrl: null, repo: 'acme/shop' }],
    ['https://github.com/acme/shop', { provider: 'github', baseUrl: null, repo: 'acme/shop' }],
    ['https://gitlab.com/group/sub/app.git', { provider: 'gitlab', baseUrl: null, repo: 'group/sub/app' }],
    ['git@git.corp.cn:team/app.git', { provider: 'gitlab', baseUrl: 'https://git.corp.cn', repo: 'team/app' }],
    [
      'ssh://git@git.corp.cn:2222/team/app.git',
      { provider: 'gitlab', baseUrl: 'https://git.corp.cn', repo: 'team/app' },
    ],
  ])('%s', (url, expected) => {
    expect(parseRemoteUrl(url)).toEqual(expected);
  });

  it.each(['/srv/git/app.git', '../other-repo', 'https://github.com/'])('无法识别的远端 %s 返回 null', (url) => {
    expect(parseRemoteUrl(url)).toBeNull();
  });
});

describe('inferCheckCommand', () => {
  const files = (...names: string[]) => new Set(names);
  const withTest = { scripts: { test: 'vitest run' } };

  it('package.json 有 test 脚本时按锁文件选包管理器', () => {
    expect(inferCheckCommand(files('package.json', 'pnpm-lock.yaml'), withTest)).toBe('pnpm test');
    expect(inferCheckCommand(files('package.json', 'yarn.lock'), withTest)).toBe('yarn test');
    expect(inferCheckCommand(files('package.json', 'bun.lock'), withTest)).toBe('bun run test');
    expect(inferCheckCommand(files('package.json'), withTest)).toBe('npm test');
  });

  it('package.json 没有 test 脚本时不推断 npm 命令', () => {
    expect(inferCheckCommand(files('package.json'), { scripts: { build: 'tsc' } })).toBeNull();
  });

  it.each([
    ['pom.xml', 'mvn -q test'],
    ['build.gradle.kts', './gradlew test'],
    ['go.mod', 'go test ./...'],
    ['pyproject.toml', 'pytest'],
  ])('%s → %s', (file, command) => {
    expect(inferCheckCommand(files(file, 'README.md'), undefined)).toBe(command);
  });

  it('无法识别时为 null', () => {
    expect(inferCheckCommand(files('README.md'), undefined)).toBeNull();
  });
});
