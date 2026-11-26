import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { DESIGN_SCAN_MAX_FILE_BYTES, type DesignSourceSnapshot } from '@aw/shared';
import { readRepoRoot, readStatus } from '../git/index.ts';
import { designExclusion } from './designs.exclusions.ts';
import { inspectDesignProject } from './designs.features.ts';

export type ScannedDesignFile = { relPath: string; contentHash: string };

export async function readDesignGitStatus(root: string) {
  if ((await readRepoRoot(root)) === undefined) return undefined;
  return readStatus(root, { readOnly: true, includeUntracked: true });
}

/** 对目录本身应用排除规则，目录命中后只记一个跳过项，不读取其中的条目。 */
export async function scanDesignFiles(root: string, patterns: readonly string[], snapshotDir?: string) {
  const files: ScannedDesignFile[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  async function visit(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relPath = posix.join(prefix, entry.name);
      const reason = designExclusion(relPath, patterns);
      if (reason !== undefined) {
        skip(reason);
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, relPath);
        continue;
      }
      if (!entry.isSymbolicLink() && !entry.isFile()) {
        skip('special');
        continue;
      }
      let source = path;
      if (entry.isSymbolicLink()) {
        // 只分析实际存在的普通文件。目录链接不重复展开，目标目录由正常目录项遍历。
        try {
          source = await realpath(path);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP')))
            throw error;
          skip('symlink');
          continue;
        }
        const target = relative(root, source).split(sep).join('/');
        if (
          isAbsolute(target) ||
          target === '..' ||
          target.startsWith('../') ||
          designExclusion(target, patterns) !== undefined
        ) {
          skip('symlink');
          continue;
        }
      }
      const info = await stat(source);
      if (!info.isFile()) {
        skip('symlink');
        continue;
      }
      if (info.size > DESIGN_SCAN_MAX_FILE_BYTES) {
        skip('oversize');
        continue;
      }
      const bytes = await readFile(source);
      if (bytes.includes(0) || !isUtf8(bytes)) {
        skip('binary');
        continue;
      }
      if (snapshotDir !== undefined) {
        // 使用与哈希相同的字节，链接仅保存扫描允许读取的普通文件内容。
        const destination = join(snapshotDir, relPath);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
      }
      files.push({ relPath, contentHash: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await visit(root, '');
  return { files: files.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en')), skipped };
}

export async function scanDesignProject(
  repoPath: string,
  patterns: readonly string[],
  scannedAt: number,
  snapshotDir?: string,
) {
  const root = await realpath(repoPath);
  const startStatus = snapshotDir === undefined ? undefined : await readDesignGitStatus(root);
  const { files, skipped } = await scanDesignFiles(root, patterns, snapshotDir);
  const features = await inspectDesignProject(snapshotDir ?? root, patterns);
  const endStatus = await readDesignGitStatus(root);
  const status = snapshotDir === undefined ? endStatus : startStatus;
  // 扫描期间变动的工作区不能沿用干净 HEAD 的过期检测快路径。
  const changedWhileScanning =
    snapshotDir !== undefined &&
    (startStatus?.commit !== endStatus?.commit ||
      startStatus?.branch !== endStatus?.branch ||
      endStatus?.clean === false);
  const snapshot: DesignSourceSnapshot = {
    branch: status?.branch ?? null,
    commitSha: status?.commit ?? null,
    dirty: changedWhileScanning || (status !== undefined && !status.clean),
    scannedAt,
    analyzableCount: files.length,
    skippedCount: [...skipped.values()].reduce((a, b) => a + b, 0),
    skippedReasons: Object.fromEntries(skipped),
    techStack: features.techStack,
  };
  return {
    files,
    snapshot,
    recommendedTemplateKey: features.recommendedTemplateKey,
  };
}
