// Fails when development-only code paths end up in the production Electron bundle (M1-06):
// the plaintext credential adapter, FakeOpencode, FakeHosting and the Chromium browser host must be compiled out of
// apps/desktop/out/main.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'apps/desktop/out/main';
// Markers are string literals inside the code itself (comments and emptied function names survive folding).
const FORBIDDEN = ['aw-dev-plaintext:', 'fake_ses', 'https://github.example/', 'aw-dev-chromium-host'];

const files = (await readdir(OUT, { recursive: true })).filter((f) => f.endsWith('.js')).map((f) => join(OUT, f));
let violations = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const marker of FORBIDDEN) {
    if (source.includes(marker)) {
      violations++;
      console.error(`${file}: contains development-only code ("${marker}")`);
    }
  }
}
if (files.length === 0) {
  console.error(`${OUT}: no bundle found — run the desktop build first`);
  process.exit(1);
}
if (violations > 0) process.exit(1);
console.log(`check-prod-bundle ok (${files.length} files)`);
