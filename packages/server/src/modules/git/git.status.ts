import type { GitStatusDTO } from '@aw/shared';
import { runGit } from './git.cli.ts';

/** Number of space-separated fields before the path in porcelain v2 entries (`1`, `2`, `u`). */
const FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = { '1': 8, '2': 9, u: 10 };

/** `git status --porcelain=v2 --branch -z`: `# branch.*` headers, then one entry per path (renames add the old path). */
export function parseStatus(output: string): GitStatusDTO {
  const status: GitStatusDTO = {
    branch: null,
    commit: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    files: [],
  };
  const fields = output.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? '';
    if (field === '') continue;
    if (field.startsWith('# ')) {
      const [key, ...rest] = field.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') status.commit = value === '(initial)' ? null : value;
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') status.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match === null) throw new Error(`Unexpected git status branch.ab ${value}`);
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
      continue;
    }
    const kind = field.charAt(0);
    if (kind === '?' || kind === '!') {
      if (kind === '?') status.files.push({ path: field.slice(2), code: '??' });
      continue;
    }
    const before = FIELDS_BEFORE_PATH[kind];
    if (before === undefined) throw new Error(`Unexpected git status entry ${field}`);
    const parts = field.split(' ');
    status.files.push({ path: parts.slice(before).join(' '), code: parts[1] ?? '' });
    // A rename or copy is followed by its original path.
    if (kind === '2') i += 1;
  }
  status.clean = status.files.length === 0;
  return status;
}

/** Branch, upstream distance and changes of the work tree at `cwd`. */
export async function readStatus(cwd: string): Promise<GitStatusDTO> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '--branch', '-z'], { cwd });
  return parseStatus(stdout);
}

/** Paths with unresolved conflicts during a merge or rebase. */
export async function unmergedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd });
  return stdout.split('\0').filter((p) => p !== '');
}
