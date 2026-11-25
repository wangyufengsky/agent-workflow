import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { DESIGN_SCAN_MAX_FILE_BYTES } from '@aw/shared';
import { locateRepoFile } from '../../core/repo-files.ts';
import { designExclusion } from './designs.exclusions.ts';
import type { DesignFile } from './designs.records.ts';

/** 文件页单独读取；只有与报告扫描时逐字节相同的内容才可用于定位证据。 */
export async function readDesignSource(
  projectRoot: string,
  file: Pick<DesignFile, 'relPath' | 'contentHash'>,
  excludePatterns: readonly string[],
) {
  try {
    const root = await realpath(projectRoot);
    const located = await locateRepoFile(root, file.relPath);
    if (
      typeof located === 'string' ||
      designExclusion(relative(root, located.real).split(sep).join('/'), excludePatterns)
    )
      return { status: 'unavailable' } as const;
    if ((await stat(located.real)).size > DESIGN_SCAN_MAX_FILE_BYTES) return { status: 'changed' } as const;
    const bytes = await readFile(located.real);
    if (createHash('sha256').update(bytes).digest('hex') !== file.contentHash) return { status: 'changed' } as const;
    return { status: 'available', content: bytes.toString('utf8') } as const;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].some((code) => code === error.code)
    )
      return { status: 'unavailable' } as const;
    throw error;
  }
}
