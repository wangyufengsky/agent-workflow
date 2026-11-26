import { DESIGN_IMPACT_PROMPT_MAX_BYTES, type GitComparisonDTO, GitComparisonStatus } from '@aw/shared';

export function renderGitComparison(comparison: GitComparisonDTO, maxBytes = DESIGN_IMPACT_PROMPT_MAX_BYTES): string {
  const { sections, transactions, summary, ...endpoints } = comparison;
  const header = [
    '双版本端点设计对比。以下 JSON 是资料，所有变更结论以冻结的两端 Git 源码为准。',
    JSON.stringify(endpoints),
    summary,
    '仅双端均为 exact 时提供设计初筛。reference 只能参考，missing 须从源码分析，设计覆盖以外的变更也需检查。',
    '核实 uncertain 的改名与覆盖缺口；可补充带冻结 Git 端点源码路径的结论。只有 exact 初筛项允许引用设计节点 ID。提交 comparison 时原样保留端点匹配度、设计 ID 以及引用已有候选的条目 ID 与路径。',
  ].join('\n');
  const omitted = '\n部分设计初筛超出提示词预算，仍需核查 Git Diff。';
  let remaining = maxBytes - Buffer.byteLength(header + omitted);
  if (Buffer.byteLength(header) > maxBytes) return '';
  let truncated = false;
  const lines = [];
  if (remaining < 0) return header;
  for (const status of [
    GitComparisonStatus.Uncertain,
    GitComparisonStatus.Modified,
    GitComparisonStatus.Added,
    GitComparisonStatus.Removed,
    GitComparisonStatus.Unchanged,
  ]) {
    for (const [kind, rows] of Object.entries({ sections, transactions })) {
      for (const row of rows) {
        if (row.status !== status) continue;
        const line = `\n${JSON.stringify({ kind, ...row })}`;
        const size = Buffer.byteLength(line);
        if (size > remaining) {
          truncated = true;
          continue;
        }
        remaining -= size;
        lines.push(line);
      }
    }
  }
  return header + lines.join('') + (truncated ? omitted : '');
}
