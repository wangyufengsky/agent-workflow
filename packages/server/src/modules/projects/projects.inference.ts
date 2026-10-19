import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HostingProvider, type HostingRef } from '@aw/shared';
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

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // An unreadable or malformed package.json only means there is no test script to infer from.
    return undefined;
  }
}

export async function inferRepoCheckCommand(repoRoot: string): Promise<string | null> {
  const files = new Set(await readdir(repoRoot));
  const packageJson = files.has('package.json') ? await readJson(join(repoRoot, 'package.json')) : undefined;
  return inferCheckCommand(files, packageJson);
}
