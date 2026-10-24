import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HostingProvider, type HostingRef, type ProjectPreview } from '@aw/shared';
import { z } from 'zod';

const SCP_LIKE = /^[\w.-]+@([\w.-]+):(.+)$/;

/** Hosting remote from an origin URL; github.com is GitHub, any other host is (possibly self-hosted) GitLab. */
export function parseRemoteUrl(url: string): HostingRef | null {
  let host: string;
  let path: string;
  const scp = SCP_LIKE.exec(url);
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    host = scp[1];
    path = scp[2];
  } else if (/^(https?|ssh):\/\//.test(url)) {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = parsed.pathname;
  } else {
    return null;
  }
  const repo = path
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  if (!repo.includes('/')) return null;
  if (host === 'github.com') return { provider: HostingProvider.Github, baseUrl: null, repo };
  return { provider: HostingProvider.Gitlab, baseUrl: host === 'gitlab.com' ? null : `https://${host}`, repo };
}

const LOCKFILE_RUNNER: ReadonlyArray<[lockfile: string, run: string]> = [
  ['pnpm-lock.yaml', 'pnpm test'],
  ['yarn.lock', 'yarn test'],
  ['bun.lock', 'bun run test'],
  ['bun.lockb', 'bun run test'],
];
const BUILD_FILE_COMMAND: ReadonlyArray<[file: string, command: string]> = [
  ['pom.xml', 'mvn -q test'],
  ['build.gradle', './gradlew test'],
  ['build.gradle.kts', './gradlew test'],
  ['go.mod', 'go test ./...'],
  ['pyproject.toml', 'pytest'],
];

const packageJsonSchema = z.object({ scripts: z.record(z.string(), z.string()).optional() });

/**
 * Project check command guessed from root files (13 §1): package.json with a `test` script → the package manager's
 * test command; otherwise the first known build file. null when nothing applies; the user can edit either way.
 */
export function inferCheckCommand(rootFiles: ReadonlySet<string>, packageJson: unknown): string | null {
  if (rootFiles.has('package.json')) {
    const parsed = packageJsonSchema.safeParse(packageJson);
    if (parsed.success && parsed.data.scripts?.test !== undefined) {
      return LOCKFILE_RUNNER.find(([lockfile]) => rootFiles.has(lockfile))?.[1] ?? 'npm test';
    }
  }
  return BUILD_FILE_COMMAND.find(([file]) => rootFiles.has(file))?.[1] ?? null;
}

/**
 * How each package manager runs a script and passes it flags (29 §12 V5): pnpm 10, yarn and bun hand flags after the
 * script name to it, while npm needs `--` (and swallows the flag's name without it); pnpm would pass a `--` on.
 */
const PACKAGE_MANAGERS: ReadonlyArray<{ lockfile: string; run: string; flags: string; setup: string }> = [
  { lockfile: 'pnpm-lock.yaml', run: 'pnpm run', flags: '', setup: 'pnpm install --frozen-lockfile' },
  { lockfile: 'yarn.lock', run: 'yarn run', flags: '', setup: 'yarn install --frozen-lockfile' },
  { lockfile: 'bun.lock', run: 'bun run', flags: '', setup: 'bun install --frozen-lockfile' },
  { lockfile: 'bun.lockb', run: 'bun run', flags: '', setup: 'bun install --frozen-lockfile' },
  { lockfile: 'package-lock.json', run: 'npm run', flags: ' --', setup: 'npm ci' },
];
const NO_LOCKFILE = { run: 'npm run', flags: ' --', setup: 'npm install' };
const PREVIEW_SCRIPTS = ['dev', 'start'] as const;

/**
 * Page preview guessed from root files (29 §4.1): package.json with a `dev` (else `start`) script. Vite does not read
 * PORT, so it gets `--port`; other dev servers (Next, Create React App) read the PORT variable the preview sets.
 * null when nothing applies; the user can edit either way.
 */
export function inferPreview(rootFiles: ReadonlySet<string>, packageJson: unknown): ProjectPreview | null {
  if (!rootFiles.has('package.json')) return null;
  const scripts = packageJsonSchema.safeParse(packageJson).data?.scripts ?? {};
  const script = PREVIEW_SCRIPTS.find((name) => scripts[name] !== undefined);
  if (script === undefined) return null;
  const pm = PACKAGE_MANAGERS.find((p) => rootFiles.has(p.lockfile)) ?? NO_LOCKFILE;
  const port = scripts[script]?.includes('vite') ? `${pm.flags} --port $PORT --strictPort` : '';
  return {
    command: `${pm.run} ${script}${port}`,
    setupCommand: pm.setup,
    readyPath: '/',
    pages: ['/'],
    extraOrigins: [],
  };
}

/** Ignore rules by what the root holds (D153): a build file names its tool, or the tool's output is already there. */
const GITIGNORE_RULES: ReadonlyArray<{ applies: (name: string) => boolean; patterns: readonly string[] }> = [
  { applies: (name) => name === 'package.json' || name === 'node_modules', patterns: ['node_modules/'] },
  { applies: (name) => name === 'pom.xml', patterns: ['target/'] },
  {
    applies: (name) => /^(build|settings)\.gradle(\.kts)?$/.test(name) || name === '.gradle',
    patterns: ['build/', '.gradle/'],
  },
  {
    applies: (name) =>
      ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', '.venv'].includes(name) || name.endsWith('.py'),
    patterns: ['__pycache__/', '.venv/'],
  },
];

/** The `.gitignore` written when the app puts a directory under Git (D153); `.DS_Store` always. */
export function inferGitignore(rootFiles: ReadonlySet<string>): string {
  const names = [...rootFiles];
  const patterns = GITIGNORE_RULES.filter((rule) => names.some(rule.applies)).flatMap((rule) => rule.patterns);
  return `${[...patterns, '.DS_Store'].join('\n')}\n`;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // An unreadable or malformed package.json only means there is no script to infer from.
    return undefined;
  }
}

async function readRoot(repoRoot: string): Promise<{ files: Set<string>; packageJson: unknown }> {
  const files = new Set(await readdir(repoRoot));
  const packageJson = files.has('package.json') ? await readJson(join(repoRoot, 'package.json')) : undefined;
  return { files, packageJson };
}

export async function inferRepoCheckCommand(repoRoot: string): Promise<string | null> {
  const { files, packageJson } = await readRoot(repoRoot);
  return inferCheckCommand(files, packageJson);
}

/** The `.gitignore` to write into `dir`; null when it already has one. */
export async function inferDirGitignore(dir: string): Promise<string | null> {
  const files = new Set(await readdir(dir));
  return files.has('.gitignore') ? null : inferGitignore(files);
}

export async function inferRepoPreview(repoRoot: string): Promise<ProjectPreview | null> {
  const { files, packageJson } = await readRoot(repoRoot);
  return inferPreview(files, packageJson);
}
