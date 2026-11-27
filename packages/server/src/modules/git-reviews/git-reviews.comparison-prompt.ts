import { DESIGN_IMPACT_PROMPT_MAX_BYTES, type GitComparisonDTO, GitComparisonStatus } from '@aw/shared';

export function renderGitComparison(comparison: GitComparisonDTO, maxBytes = DESIGN_IMPACT_PROMPT_MAX_BYTES): string {
  const { sections, transactions, summary, ...endpoints } = comparison;
  const header = [
    '双版本端点设计对比。以下 JSON 是资料，所有变更结论以冻结的两端 Git 源码为准。',
    JSON.stringify(endpoints),
    summary,
    '仅双端均为 exact 时提供设计初筛。reference 只能参考，missing 须从源码分析，设计覆盖以外的变更也需检查。',
    '提交 comparison 时原样复制上方端点元数据。只有 exact 初筛项允许引用设计节点 ID：复制该行的 fromId、toId 和路径。下方业务影响候选的 targetId 仅供 impacts 使用。',
    '从源码核实的 sections 和 transactions 条目只填变更文件在对应端点的路径，省略 fromId 和 toId。modified / unchanged 填 fromPath 和 toPath（改名用旧名和新名）；added 只填 toPath，removed 只填 fromPath，uncertain 至少填一侧。',
    '同一路径发生修改时的格式示例（提交时替换为核实的标题和实际路径）：',
    '{"status":"modified","title":"模块行为变化","fromPath":"src/example.ts","toPath":"src/example.ts"}',
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
