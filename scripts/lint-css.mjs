// Component styles must use theme tokens (var(--token)); colour literals live only in apps/web/src/theme/.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = 'apps/web/src';
const ALLOWED_DIR = join(ROOT, 'theme');
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g;

const files = (await readdir(ROOT, { recursive: true }))
  .map((f) => join(ROOT, f))
  .filter((f) => f.endsWith('.css') && !f.startsWith(ALLOWED_DIR));

let violations = 0;
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(COLOR_LITERAL)) {
      violations++;
      console.error(`${relative('.', file)}:${i + 1}: colour literal "${m[0]}" — use a theme token`);
    }
  });
}
if (violations > 0) process.exit(1);
console.log(`lint:css ok (${files.length} files)`);
