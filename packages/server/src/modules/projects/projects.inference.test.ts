import { describe, expect, it } from 'vitest';
import { inferCheckCommand, inferGitignore, inferPreview, parseRemoteUrl } from './projects.inference.ts';

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
    // An HTTP(S) origin is the GitLab's web address: its scheme and port are kept (D155 matches global tokens on it).
    [
      'https://gitlab.example.com:8443/acme/shop.git',
      { provider: 'gitlab', baseUrl: 'https://gitlab.example.com:8443', repo: 'acme/shop' },
    ],
    ['http://git.lan/team/app.git', { provider: 'gitlab', baseUrl: 'http://git.lan', repo: 'team/app' }],
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

describe('inferPreview', () => {
  const files = (...names: string[]) => new Set(['package.json', ...names]);
  const vite = { scripts: { dev: 'vite', start: 'node server.js' } };
  const command = (lockfile: string | null, packageJson: unknown) =>
    inferPreview(lockfile === null ? files() : files(lockfile), packageJson)?.command;

  it('Vite 按包管理器传端口参数：只有 npm 要加 --', () => {
    expect(command('pnpm-lock.yaml', vite)).toBe('pnpm run dev --port $PORT --strictPort');
    expect(command('yarn.lock', vite)).toBe('yarn run dev --port $PORT --strictPort');
    expect(command('bun.lock', vite)).toBe('bun run dev --port $PORT --strictPort');
    expect(command('package-lock.json', vite)).toBe('npm run dev -- --port $PORT --strictPort');
    expect(command(null, vite)).toBe('npm run dev -- --port $PORT --strictPort');
  });

  it('其他开发服务器只靠 PORT 环境变量；没有 dev 脚本时用 start', () => {
    expect(command('pnpm-lock.yaml', { scripts: { dev: 'next dev' } })).toBe('pnpm run dev');
    expect(command('package-lock.json', { scripts: { start: 'react-scripts start' } })).toBe('npm run start');
  });

  it('安装命令按锁文件选，其余字段为默认值', () => {
    expect(inferPreview(files('pnpm-lock.yaml'), vite)).toEqual({
      command: 'pnpm run dev --port $PORT --strictPort',
      setupCommand: 'pnpm install --frozen-lockfile',
      readyPath: '/',
      pages: ['/'],
      extraOrigins: [],
    });
    expect(inferPreview(files('package-lock.json'), vite)?.setupCommand).toBe('npm ci');
    expect(inferPreview(files(), vite)?.setupCommand).toBe('npm install');
  });

  it('没有 package.json、或没有 dev / start 脚本时不推断', () => {
    expect(inferPreview(new Set(['pom.xml']), undefined)).toBeNull();
    expect(inferPreview(files('pnpm-lock.yaml'), { scripts: { build: 'tsc' } })).toBeNull();
    expect(inferPreview(files(), 'not json')).toBeNull();
  });
});

describe('inferGitignore', () => {
  const files = (...names: string[]) => new Set(names);

  it.each([
    [files('README.md'), ['.DS_Store']],
    [files('package.json', 'src'), ['node_modules/', '.DS_Store']],
    [files('pom.xml'), ['target/', '.DS_Store']],
    [files('settings.gradle.kts', 'app'), ['build/', '.gradle/', '.DS_Store']],
    [files('main.py'), ['__pycache__/', '.venv/', '.DS_Store']],
    [
      files('node_modules', 'pom.xml', 'requirements.txt'),
      ['node_modules/', 'target/', '__pycache__/', '.venv/', '.DS_Store'],
    ],
  ])('%o', (rootFiles, lines) => {
    expect(inferGitignore(rootFiles)).toBe(`${lines.join('\n')}\n`);
  });
});
