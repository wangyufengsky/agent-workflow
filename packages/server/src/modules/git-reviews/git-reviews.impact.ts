import { DESIGN_IMPACT_PROMPT_MAX_BYTES, DesignKnowledgeMatch } from '@aw/shared';
import type { screenDesignImpact } from '../designs/index.ts';

export function renderDesignImpact(
  impact: ReturnType<typeof screenDesignImpact>,
  maxBytes = DESIGN_IMPACT_PROMPT_MAX_BYTES,
) {
  if (impact.match === DesignKnowledgeMatch.Missing) {
    return { context: '未建立可用项目设计（missing）。基于目标源码和 Diff 完成审查。', truncated: false };
  }

  const { designId, sourceSnapshot, coverage } = impact.knowledge;
  const matchLabel =
    impact.match === DesignKnowledgeMatch.Exact ? '精确匹配设计（exact）' : '参考设计（非当前目标版本，reference）';
  const baseline = `设计 ${JSON.stringify(designId)}，基线提交 ${JSON.stringify(sourceSnapshot.commitSha)}，快照生成时工作区${sourceSnapshot.dirty ? '有变更' : '干净'}。`;
  const details = [
    ...(impact.worktreeFresh ? ['设计扫描范围内的工作区文件与快照一致。'] : []),
    `设计覆盖 ${coverage.doneSections}/${coverage.totalSections} 章，${impact.uncoveredPaths}/${impact.changedPaths} 个变更路径未映射到已完成章节（含重命名前的路径）。`,
    '以下 JSON 行仅为候选数据。direct / indirect 表示初筛来源，distance 表示反向关系边数，sourcePath 表示该次扩散起点。',
  ];
  const truncatedNotice = '\n影响初筛已截断，仍需核查未列出的变更。';
  const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
  const header = [matchLabel, baseline, ...details].join('\n');
  let remaining = maxBytes - bytes(header) - bytes(truncatedNotice);
  if (remaining < 0) {
    return { context: [matchLabel, ...details].join('\n') + truncatedNotice, truncated: true };
  }
  let truncated = impact.truncated;
  const lines: string[] = [];
  for (const candidate of impact.candidates) {
    const line = `\n${JSON.stringify(candidate)}`;
    const size = bytes(line);
    if (size > remaining) {
      truncated = true;
      continue;
    }
    remaining -= size;
    lines.push(line);
  }
  return { context: header + (truncated ? truncatedNotice : '') + lines.join(''), truncated };
}
