import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `os.tmpdir()` reads TMPDIR on macOS and Linux, TEMP and TMP on Windows.
const KEYS = ['TMPDIR', 'TEMP', 'TMP'] as const;

/**
 * Makes a directory in the current temporary directory and points `os.tmpdir()` at it, for this process and the ones
 * it starts afterwards, so that whatever tests create with `mkdtemp(join(tmpdir(), …))` lands inside it and goes with
 * it (07 §7). `restore` points it back where it was.
 */
export function redirectTmpdir(prefix: string): { dir: string; restore(): void } {
  const previous = KEYS.map((key) => process.env[key]);
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const key of KEYS) process.env[key] = dir;
  return {
    dir,
    restore() {
      KEYS.forEach((key, i) => {
        const value = previous[i];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    },
  };
}
