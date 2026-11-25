/** 系统文件管理器只能定位文件，具体行号由证据位置提供。 */
export function revealDesignSource(repoPath: string | null, relPath: string): boolean {
  if (window.aw === undefined || repoPath === null) return false;
  const separator = /^(?:[a-z]:\\|\\\\)/i.test(repoPath) ? '\\' : '/';
  const root = repoPath.endsWith(separator) ? repoPath.slice(0, -1) : repoPath;
  void window.aw.revealInFinder(root + separator + relPath.split('/').join(separator));
  return true;
}
