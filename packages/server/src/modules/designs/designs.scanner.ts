import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { DESIGN_SCAN_MAX_FILE_BYTES, type DesignSourceSnapshot } from '@aw/shared';
import { readRepoRoot, readStatus } from '../git/index.ts';
import { designExclusion } from './designs.exclusions.ts';
import { inspectDesignProject } from './designs.features.ts';

export type ScannedDesignFile = { relPath: string; contentHash: string };

/** 对目录本身应用排除规则，目录命中后只记一个跳过项，不读取其中的条目。 */
export async function scanDesignProject(repoPath: string, patterns: readonly string[], scannedAt: number) {
  const root = await realpath(repoPath);
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
      files.push({ relPath, contentHash: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await visit(root, '');
  const features = await inspectDesignProject(root, patterns);
  const status = (await readRepoRoot(root)) === undefined ? undefined : await readStatus(root);
  const snapshot: DesignSourceSnapshot = {
    branch: status?.branch ?? null,
    commitSha: status?.commit ?? null,
    dirty: status !== undefined && !status.clean,
    scannedAt,
    analyzableCount: files.length,
    skippedCount: [...skipped.values()].reduce((a, b) => a + b, 0),
    skippedReasons: Object.fromEntries(skipped),
    techStack: features.techStack,
  };
  return {
    files: files.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en')),
    snapshot,
    recommendedTemplateKey: features.recommendedTemplateKey,
  };
}
