import type { TaskCodeReviewReport } from '@aw/shared';
import { GIT_COPY } from './git.ts';

export const TASK_CODE_REVIEW_COPY = {
  title: '代码审查报告',
  findings: '问题清单',
  code: '代码位置',
  all: '全部',
  complete: '完成审查',
  awaitingReport: '待查看报告',
  building: '正在审查代码',
  buildingHint: '审查完成后，问题清单会自动显示。',
  empty: '审查报告尚未提交。',
  noMatches: '这一严重程度没有发现。',
  legacy: '这次审查保存的是文字报告。',
  summary: '审查结论',
  openInGit: '在 Git 工作台打开',
  close: '收起侧栏',
  location: (path: string, line: number | undefined, end: number | undefined) =>
    line === undefined ? path : `${path}:${line}${end === undefined || end === line ? '' : `–${end}`}`,
  scope: (source: TaskCodeReviewReport['scope']) =>
    source.kind === 'diff'
      ? `${source.from.slice(0, 8)}…${source.to.slice(0, 8)}`
      : `${source.directory || '整个仓库'} · ${source.commit.slice(0, 8)}`,
  filter: (label: string, count: number) => `${label} ${count}`,
  severity: GIT_COPY.severity,
  category: GIT_COPY.category,
  suggestion: GIT_COPY.suggestion,
  clean: GIT_COPY.verdictClean,
} as const;
