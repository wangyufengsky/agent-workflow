import { rmSync } from 'node:fs';
import { afterAll } from 'vitest';
import { redirectTmpdir } from '../helpers/temp.ts';

// Every temporary directory a test file makes (its own, createTestApp's data directory, createTestRepo's
// repositories, those of the backends and processes it starts) lands in one directory of the file, removed after the
// file. Setup files register their hooks first and `afterAll` hooks run in reverse order, so this runs after the
// file's own hooks have closed its backends and processes. A file that fails to load runs no hooks: its directory is
// left in the run's (temp-root.ts).
const temp = redirectTmpdir('aw-test-');

afterAll(() => {
  // A worker may run another file next, whose setup starts from the run's directory again.
  temp.restore();
  rmSync(temp.dir, { recursive: true });
});
