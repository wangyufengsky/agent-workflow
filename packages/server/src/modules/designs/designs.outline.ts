import { posix } from 'node:path';
import {
  DESIGN_MAX_SECTIONS,
  DESIGN_TITLE_MAX_CHARS,
  type DesignOutlineSection,
  DesignSectionKind,
  type DesignTemplateSection,
} from '@aw/shared';

/** 模板中的范围是线索。只有实际存在于本次扫描的目录和文件能进入可编辑大纲。 */
export function initialDesignOutline(
  blueprint: readonly DesignTemplateSection[],
  files: readonly { relPath: string }[],
): DesignOutlineSection[] {
  const dirs = new Set<string>();
  const paths = new Set<string>();
  for (const { relPath } of files) {
    paths.add(relPath);
    let dir = posix.dirname(relPath);
    while (dir !== '.') {
      dirs.add(dir);
      dir = posix.dirname(dir);
    }
  }
  const scopes = [...new Set([...dirs, ...paths])].sort();
  const modules = new Set<string>();
  for (const { relPath } of files) {
    const parts = relPath.split('/');
    const top = parts[0];
    if (parts.length < 2 || top === undefined) continue;
    if (['apps', 'packages', 'src'].includes(top) && parts.length > 2) modules.add(parts.slice(0, 2).join('/'));
    else modules.add(top);
  }
  const outline: DesignOutlineSection[] = [];
  let extra = DESIGN_MAX_SECTIONS - blueprint.length;
  for (const { kind, title, scopeHint } of blueprint) {
    const hint = scopeHint.trim().replace(/\/$/, '');
    const matched = hint === '' || hint === '.' ? [] : scopes.filter((p) => posix.matchesGlob(p, hint));
    if (kind !== DesignSectionKind.Module) {
      outline.push({ kind, title, scopePaths: matched, selected: true });
      continue;
    }
    const candidates = [...modules]
      .filter(
        (module) => matched.length === 0 || matched.some((path) => module === path || module.startsWith(`${path}/`)),
      )
      .sort();
    if (candidates.length <= 1 || extra === 0) {
      outline.push({ kind, title, scopePaths: matched.length > 0 ? matched : candidates, selected: true });
      continue;
    }
    // 保留每条模板蓝图的一章；超出章节上限的目录共用最后一个模块章节。
    const count = Math.min(candidates.length, extra + 1);
    for (let i = 0; i < count; i++) {
      const scopePaths = candidates.slice(i, i === count - 1 ? undefined : i + 1);
      const heading = scopePaths.length === 1 ? `${title} · ${scopePaths[0]}`.slice(0, DESIGN_TITLE_MAX_CHARS) : title;
      outline.push({ kind, title: heading, scopePaths, selected: true });
    }
    extra -= count - 1;
  }
  return outline;
}
