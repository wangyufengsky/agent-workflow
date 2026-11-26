import {
  AppError,
  ErrorCode,
  type GitComparisonDTO,
  type GitComparisonItemDTO,
  GitComparisonStatus,
  gitComparisonSchema,
} from '@aw/shared';

const kinds = ['sections', 'transactions'] as const;
type ComparisonKind = (typeof kinds)[number];
type Issue = { path: Array<string | number>; message: string };

const entityKey = ({ fromId, toId }: GitComparisonItemDTO) => JSON.stringify([fromId, toId]);
const hasDesignId = ({ fromId, toId }: GitComparisonItemDTO) => fromId !== undefined || toId !== undefined;

function validSides(item: GitComparisonItemDTO) {
  const hasOlder = item.fromId !== undefined || item.fromPath !== undefined;
  const hasNewer = item.toId !== undefined || item.toPath !== undefined;
  switch (item.status) {
    case GitComparisonStatus.Added:
      return !hasOlder && hasNewer;
    case GitComparisonStatus.Removed:
      return hasOlder && !hasNewer;
    case GitComparisonStatus.Modified:
    case GitComparisonStatus.Unchanged:
      return hasOlder && hasNewer;
    case GitComparisonStatus.Uncertain:
      return hasOlder || hasNewer;
  }
}

function mergeItems(
  kind: ComparisonKind,
  screened: readonly GitComparisonItemDTO[],
  proposed: readonly GitComparisonItemDTO[],
  issues: Issue[],
): GitComparisonItemDTO[] {
  const known = new Map(screened.map((row) => [entityKey(row), row]));
  const updates = new Map<GitComparisonItemDTO, GitComparisonItemDTO>();
  const source: GitComparisonItemDTO[] = [];
  const sourceKeys = new Set<string>();
  for (const [index, item] of proposed.entries()) {
    const path = ['comparison', kind, index];
    if (!validSides(item)) {
      issues.push({ path, message: 'Status must agree with the sides named by the item' });
      continue;
    }
    if (!hasDesignId(item)) {
      const key = JSON.stringify([item.title, item.fromPath, item.toPath]);
      if (sourceKeys.has(key)) issues.push({ path, message: 'Duplicate source comparison item' });
      else source.push(item);
      sourceKeys.add(key);
      continue;
    }

    const original = known.get(entityKey(item));
    if (original === undefined || original.fromPath !== item.fromPath || original.toPath !== item.toPath) {
      issues.push({ path, message: 'Design item IDs and paths must match a single exact alignment candidate' });
    } else if (updates.has(original)) {
      issues.push({ path, message: 'Duplicate design comparison item' });
    } else if (item.status !== original.status && item.detail === undefined) {
      issues.push({ path: [...path, 'detail'], message: 'Explain this change to the initial comparison status' });
    } else {
      updates.set(original, {
        ...original,
        status: item.status,
        ...(item.detail === undefined ? {} : { detail: item.detail }),
      });
    }
  }
  return [...screened.map((row) => updates.get(row) ?? row), ...source];
}

export function mergeGitComparison(
  baseline: GitComparisonDTO | undefined,
  input: GitComparisonDTO | undefined,
  summary: string,
): GitComparisonDTO | undefined {
  if (input === undefined) {
    if (baseline === undefined) return undefined;
    const parsed = gitComparisonSchema.shape.summary.safeParse(summary);
    if (!parsed.success)
      throw new AppError(ErrorCode.ValidationFailed, 'Invalid comparison summary', {
        issues: parsed.error.issues.map(({ message }) => ({ path: ['summary'], message })),
      });
    return { ...baseline, summary: parsed.data };
  }
  if (baseline === undefined)
    throw new AppError(ErrorCode.ValidationFailed, 'Comparison only applies to compare reviews', {
      issues: [{ path: ['comparison'], message: 'Only compare reviews accept comparison' }],
    });

  const issues: Issue[] = [];
  for (const key of ['fromDesignId', 'toDesignId', 'fromMatch', 'toMatch'] as const) {
    if (input[key] !== baseline[key])
      issues.push({ path: ['comparison', key], message: 'Endpoint metadata is fixed when the review starts' });
  }
  const sections = mergeItems('sections', baseline.sections, input.sections, issues);
  const transactions = mergeItems('transactions', baseline.transactions, input.transactions, issues);
  if (issues.length > 0) throw new AppError(ErrorCode.ValidationFailed, 'Invalid comparison', { issues });

  return { ...baseline, sections, transactions, summary: input.summary };
}
