// 构建源码运行和桌面 Resources/opencode-plugin 共用的 V1 插件。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const source = new URL('../packages/opencode-plugin/src/', import.meta.url);
const dist = new URL('../packages/opencode-plugin/dist/', import.meta.url);
await mkdir(dist, { recursive: true });
for (const name of ['agent-workflow-bridge', 'context', 'projection', 'budget', 'messages', 'limits']) {
  const { outputText } = ts.transpileModule(
    (
      await readFile(
        ['projection', 'budget', 'messages', 'limits'].includes(name)
          ? new URL(`../../shared/src/context/${name}.ts`, source)
          : new URL(`${name}.ts`, source),
        'utf8',
      )
    ).replaceAll("'@aw/shared/context'", "'./projection.ts'"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        rewriteRelativeImportExtensions: true,
      },
    },
  );
  await writeFile(new URL(`${name}.js`, dist), outputText);
}
