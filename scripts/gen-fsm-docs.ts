// Regenerates the state diagrams in docs/09-state-machines.md from packages/shared/src/fsm.
// `--check` only verifies the document is in sync and exits 1 otherwise (part of `pnpm check`).
import { readFile, writeFile } from 'node:fs/promises';
import { MACHINES, toMermaid } from '@aw/shared';

const DOC = 'docs/09-state-machines.md';
const check = process.argv.includes('--check');

const block = (name: string, mermaid: string) =>
  `<!-- fsm:${name} 由 pnpm gen:fsm-docs 生成，勿手改 -->\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n<!-- /fsm:${name} -->`;

const original = await readFile(DOC, 'utf8');
let updated = original;
const problems: string[] = [];
for (const [name, machine] of Object.entries(MACHINES)) {
  const pattern = new RegExp(`<!-- fsm:${name} [^>]*-->\\n[\\s\\S]*?<!-- /fsm:${name} -->`, 'g');
  const matches = updated.match(pattern) ?? [];
  if (matches.length !== 1) {
    problems.push(`${DOC}: expected exactly one fsm:${name} block, found ${matches.length}`);
    continue;
  }
  updated = updated.replace(pattern, block(name, toMermaid(machine)));
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
if (updated === original) {
  console.log(`gen:fsm-docs ok (${Object.keys(MACHINES).length} machines in sync)`);
} else if (check) {
  console.error(`${DOC} is out of sync with packages/shared/src/fsm — run \`pnpm gen:fsm-docs\``);
  process.exit(1);
} else {
  await writeFile(DOC, updated);
  console.log(`gen:fsm-docs updated ${DOC}`);
}
