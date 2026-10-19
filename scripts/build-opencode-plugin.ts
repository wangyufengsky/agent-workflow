// Builds the opencode bridge plugin (M2-03) into a standalone JS file: opencode loads it from
// packages/opencode-plugin/dist (source runs) or Resources/opencode-plugin (packaged app). The source only uses
// erasable TypeScript syntax and type-only imports, so stripping types is the whole build.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const SOURCE = new URL('../packages/opencode-plugin/src/agent-workflow-bridge.ts', import.meta.url);
const OUT_DIR = new URL('../packages/opencode-plugin/dist/', import.meta.url);

const js = stripTypeScriptTypes(await readFile(SOURCE, 'utf8'));
await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('agent-workflow-bridge.js', OUT_DIR), js);
console.log('built packages/opencode-plugin/dist/agent-workflow-bridge.js');
