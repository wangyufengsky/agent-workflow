import { DIFF_FILE_MAX_BYTES, type GitFileDTO, type GitTreeEntryDTO, GitTreeEntryType } from '@aw/shared';
import { runGit } from './git.cli.ts';

const ENTRY_TYPES: ReadonlySet<string> = new Set(Object.values(GitTreeEntryType));
const isEntryType = (type: string): type is GitTreeEntryType => ENTRY_TYPES.has(type);

/** `git ls-tree -z --long <tree>`: `<mode> <type> <object> <size>\t<name>`, size `-` for trees and submodules. */
export function parseLsTree(output: string, dir: string): GitTreeEntryDTO[] {
  const entries = output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [, type, , size] = entry.slice(0, tab).split(/ +/);
      const name = entry.slice(tab + 1);
      if (tab < 0 || type === undefined || size === undefined || !isEntryType(type)) {
        throw new Error(`Unexpected git ls-tree entry ${entry}`);
      }
      return { name, path: dir === '' ? name : `${dir}/${name}`, type, size: size === '-' ? null : Number(size) };
    });
  // Directories first, then by name, as file browsers list them.
  return entries.sort(
    (a, b) =>
      Number(b.type === GitTreeEntryType.Tree) - Number(a.type === GitTreeEntryType.Tree) ||
      a.name.localeCompare(b.name),
  );
}

/** Entries of directory `dir` (`''` for the root) at `ref`. */
export async function readTree(repo: string, ref: string, dir: string): Promise<GitTreeEntryDTO[]> {
  const { stdout } = await runGit(['ls-tree', '-z', '--long', '--end-of-options', `${ref}:${dir}`], { cwd: repo });
  return parseLsTree(stdout, dir);
}

/** A file at `ref`; binary content (a NUL byte) and files over DIFF_FILE_MAX_BYTES are not returned. */
export async function readFile(repo: string, ref: string, path: string): Promise<GitFileDTO> {
  const object = `${ref}:${path}`;
  const size = Number((await runGit(['cat-file', '-s', '--end-of-options', object], { cwd: repo })).stdout.trim());
  if (size > DIFF_FILE_MAX_BYTES) return { path, tooLarge: true, size };
  const { stdout } = await runGit(['cat-file', 'blob', '--end-of-options', object], { cwd: repo, verbatim: true });
  return stdout.includes('\0') ? { path, binary: true } : { path, content: stdout };
}
