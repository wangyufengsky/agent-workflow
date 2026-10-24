import { rmSync } from 'node:fs';
import { redirectTmpdir } from '../helpers/temp.ts';

/**
 * One temporary directory per run of a Vitest project, which the workers inherit with the environment and put each
 * test file's directory in (temp-dir.ts); removed once the workers have exited, with whatever a file that failed to
 * load left behind.
 */
export function setup(): () => void {
  const temp = redirectTmpdir('aw-vitest-');
  return () => rmSync(temp.dir, { recursive: true });
}
