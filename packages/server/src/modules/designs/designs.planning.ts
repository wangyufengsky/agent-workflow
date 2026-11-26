/** 为源码、工具和后续对话留出空间。预算按序列化后的 UTF-8 字节数计算。 */
const SAMPLE_LIMIT = 256;
const FILE_BYTES = 11 * 1024;
const DIRECTORY_BYTES = 4 * 1024;
const PAGE_FILES = 64;
type FilePath = { relPath: string };
type Scope = { scopePaths: readonly string[] };

/** 按目录边界匹配，范围较多时也只需检查路径的各级前缀。 */
export function designScope(sections: readonly Scope[]) {
  if (sections.some(({ scopePaths }) => scopePaths.length === 0)) return () => true;
  const scopes = new Set(sections.flatMap(({ scopePaths }) => scopePaths));
  return (path: string) => {
    if (scopes.has(path)) return true;
    for (let end = path.indexOf('/'); end >= 0; end = path.indexOf('/', end + 1)) {
      if (scopes.has(path.slice(0, end))) return true;
    }
    return false;
  };
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value)) + 1;

export function planningInventory<T extends FilePath>(files: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const slash = file.relPath.lastIndexOf('/');
    const scope = slash < 0 ? '.' : file.relPath.slice(0, slash);
    const group = groups.get(scope);
    if (group === undefined) groups.set(scope, [file]);
    else group.push(file);
  }
  // 根目录保留 README 和构建入口；按实际父目录轮选，src/main/java 下的包也能分别取样。
  const largest = [...groups]
    .sort(([a, left], [b, right]) => Number(b === '.') - Number(a === '.') || right.length - left.length)
    .slice(0, SAMPLE_LIMIT);
  const directories = [];
  let directoryBytes = DIRECTORY_BYTES;
  for (const [scope, paths] of largest) {
    const directory = { scope, fileCount: paths.length };
    const bytes = jsonBytes(directory);
    if (bytes > directoryBytes) continue;
    directories.push(directory);
    directoryBytes -= bytes;
  }
  const authorizedFiles: T[] = [];
  let remaining = FILE_BYTES;
  // 各目录轮流提供入口，避免一个大目录耗尽预算。
  for (let i = 0; authorizedFiles.length < SAMPLE_LIMIT; i++) {
    const before = authorizedFiles.length;
    for (const [, paths] of largest) {
      const file = paths[i];
      if (file === undefined) continue;
      const bytes = jsonBytes(file);
      if (bytes > remaining) continue;
      authorizedFiles.push(file);
      remaining -= bytes;
      if (authorizedFiles.length === SAMPLE_LIMIT) break;
    }
    if (before === authorizedFiles.length) break;
  }
  return {
    authorizedFiles,
    fileCount: files.length,
    directoryCount: groups.size,
    directories,
    inventorySampled: authorizedFiles.length < files.length,
  };
}

/** 数据库按路径排序；offset 针对同一搜索的匹配结果。 */
export function designFilePage<T extends FilePath>(inventory: readonly T[], query: string, offset: number) {
  const needle = query.toLowerCase();
  const matches = inventory.filter(({ relPath }) => relPath.toLowerCase().includes(needle));
  const files: T[] = [];
  let remaining = FILE_BYTES;
  for (const file of matches.slice(offset, offset + PAGE_FILES)) {
    const bytes = jsonBytes(file);
    // 一个很长的合法路径也必须能够翻页取到。
    if (files.length && bytes > remaining) break;
    files.push(file);
    remaining -= bytes;
  }
  const next = offset + files.length;
  return { files, total: matches.length, nextOffset: next < matches.length ? next : null };
}
