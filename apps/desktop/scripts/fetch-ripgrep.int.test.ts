import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);

it('Windows 打包复用 win-x64 中完整的 rg.exe，不下载其他平台的二进制', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aw-ripgrep-test-'));
  const scripts = join(root, 'scripts');
  const target = join(root, 'build', 'ripgrep', 'win-x64');
  await mkdir(scripts);
  await mkdir(target, { recursive: true });
  const script = join(scripts, 'fetch-ripgrep.mjs');
  await copyFile(new URL('./fetch-ripgrep.mjs', import.meta.url), script);
  await writeFile(join(target, 'rg.exe'), 'existing Windows executable');
  const { stderr } = await exec(process.execPath, [
    '--input-type=module',
    '-e',
    `Object.defineProperty(process, 'platform', { value: 'win32' });
     globalThis.fetch = () => { throw new Error('unexpected download'); };
     await import(${JSON.stringify(pathToFileURL(script).href)});`,
  ]);
  expect(stderr).toBe('');
  expect(await readFile(join(target, 'rg.exe'), 'utf8')).toBe('existing Windows executable');
});
