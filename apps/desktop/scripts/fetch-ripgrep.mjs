// Puts the ripgrep the installer bundles into build/ripgrep/<os>-<arch>/ (D213): opencode's grep, glob and skill tools
// run rg, and where it is neither on PATH nor in opencode's cache opencode downloads it from GitHub, which intranet
// machines cannot reach. The same release opencode 1.19 downloads, checked against the published SHA-256. Fetches
// every architecture of this OS, as `pnpm dist --x64 --arm64` packages both; a target already in place is kept.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '15.1.0';
/** electron-builder's `${os}-${arch}` → the release asset and its SHA-256. */
const TARGETS = {
  'mac-arm64': {
    asset: 'aarch64-apple-darwin',
    sha256: '378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715',
  },
  'linux-x64': {
    asset: 'x86_64-unknown-linux-musl',
    sha256: '1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599',
  },
  'linux-arm64': {
    asset: 'aarch64-unknown-linux-gnu',
    sha256: '2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e',
  },
  'win-x64': {
    asset: 'x86_64-pc-windows-msvc',
    sha256: '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a',
  },
};
/** Shipped next to rg: ripgrep is dual-licensed MIT / Unlicense. */
const LICENSE_FILES = ['COPYING', 'LICENSE-MIT', 'UNLICENSE'];
const OS = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform];
if (OS === undefined) throw new Error(`no bundled ripgrep for ${process.platform}`);
const executable = OS === 'win' ? 'rg.exe' : 'rg';
const extension = OS === 'win' ? 'zip' : 'tar.gz';

const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );

for (const [target, { asset, sha256 }] of Object.entries(TARGETS)) {
  if (!target.startsWith(`${OS}-`)) continue;
  const dir = join(import.meta.dirname, '..', 'build', 'ripgrep', target);
  if (await exists(join(dir, executable))) continue;
  const name = `ripgrep-${VERSION}-${asset}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${name}.${extension}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== sha256) throw new Error(`${url}: SHA-256 ${actual}, expected ${sha256}`);
  const scratch = await mkdtemp(join(tmpdir(), 'aw-ripgrep-'));
  try {
    const archivePath = join(scratch, `rg.${extension}`);
    await writeFile(archivePath, archive);
    // Windows 10/11 的系统 tar（bsdtar）支持 zip；POSIX tar 自动识别 gzip。
    execFileSync('tar', ['-xf', archivePath, '-C', scratch]);
    await mkdir(dir, { recursive: true });
    // rg last: its presence marks a complete target.
    for (const file of [...LICENSE_FILES, executable]) await copyFile(join(scratch, name, file), join(dir, file));
    if (OS !== 'win') await chmod(join(dir, executable), 0o755);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(`ripgrep ${VERSION} → build/ripgrep/${target}`);
}
