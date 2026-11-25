// 构建源码运行和桌面 Resources/opencode-plugin 共用的 V1 插件。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = new URL('../packages/opencode-plugin/src/', import.meta.url);
const dist = new URL('../packages/opencode-plugin/dist/', import.meta.url);
await mkdir(dist, { recursive: true });
for (const name of ['agent-workflow-bridge', 'context']) {
  const { outputText } = ts.transpileModule(await readFile(new URL(`${name}.ts`, source), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      rewriteRelativeImportExtensions: true,
    },
  });
  await writeFile(new URL(`${name}.js`, dist), outputText);
}
