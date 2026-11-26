/** 限制规划会话的文件清单，给入口抽查和实际规划留出上下文。 */
const PLAN_SAMPLE_LIMIT = 256;

export function planningInventory(files: readonly { relPath: string }[]) {
  const groups = new Map<string, string[]>();
  for (const { relPath } of files) {
    const scope = relPath.split('/').slice(0, -1).slice(0, 2).join('/') || '.';
    const paths = groups.get(scope);
    if (paths === undefined) groups.set(scope, [relPath]);
    else paths.push(relPath);
  }
  const directories = [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, PLAN_SAMPLE_LIMIT);
  const authorizedFiles: { relPath: string }[] = [];
  // 先让不同目录各有一个样本，再按轮次补充，避免一个大目录占满清单。
  for (let i = 0; authorizedFiles.length < PLAN_SAMPLE_LIMIT; i++) {
    const before = authorizedFiles.length;
    for (const [, paths] of directories) {
      const relPath = paths[i];
      if (relPath !== undefined) authorizedFiles.push({ relPath });
      if (authorizedFiles.length === PLAN_SAMPLE_LIMIT) break;
    }
    if (authorizedFiles.length === before) break;
  }
  return {
    authorizedFiles,
    directoryCount: groups.size,
    directories: directories.map(([scope, paths]) => ({ scope, fileCount: paths.length })),
    inventorySampled: authorizedFiles.length < files.length,
  };
}
