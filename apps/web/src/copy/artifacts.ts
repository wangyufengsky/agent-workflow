import type { ArtifactAnchor } from '@aw/shared';

const lineRange = (from: number, to: number) => (from === to ? String(from) : `${from}–${to}`);

export function artifactAnchorLabel(anchor: ArtifactAnchor): string {
  if (anchor.kind === 'cells') return `${anchor.sheet}!${anchor.range}`;
  if (anchor.kind === 'whole') return '整份文件';
  const range = `第 ${lineRange(anchor.lines.from, anchor.lines.to)} 行`;
  return anchor.kind === 'paragraph' && anchor.heading !== '' ? `${anchor.heading} · ${range}` : range;
}

export const ARTIFACT_COPY = {
  selectFile: '选择文档',
  workingDraft: '工作区草稿',
  panels: {
    activity: 'AI 活动',
    notes: '标注修改',
    history: '版本记录',
    record: '任务记录',
  },
  workbench: '产物工作台',
  file: '任务产物',
  version: '产物版本',
  latest: ' · 最新',
  save: '保存原件',
  accept: '验收产物',
  deliver: '验收并交付',
  awaitingDocument: '待查看文档',
  beforeLabel: (version: number) => `改前 v${version}`,
  before: (version: number) => `改前 · v${version}`,
  previewLabel: (version: number) => `产物预览 v${version}`,
  after: (version: number) => `改后 · v${version}`,
  openLatest: '打开最新版本',
  awaitingDraft: '等待写入文档',
  awaitingDraftHint: 'AI 将文档写入工作区后，正文会在这里自动打开。',
  building: '正在生成首版产物',
  buildingHint: '首个文件发布后会自动打开预览。',
  empty: '还没有可查看的文件。',
  closeSidebar: '收起侧栏',
  closeCompare: '关闭对照',
  compare: '对照上一版',
  viewActivity: '查看执行过程',
  pickHint: '在预览中选中内容。按住 Shift 可选择多行或单元格区域。',
  reviewHint: '在最新版本待查看时可提交意见。',
  note: '怎么修改',
  add: '加入本轮',
  cancel: '取消标注',
  removeNote: (number: number) => `移除第 ${number} 条意见`,
  wholeFile: '整份文件意见',
  submit: '交给 AI 修改',
  markLines: (from: number, to = from) => `标注第 ${lineRange(from, to)} 行`,
  previousPage: '上一页',
  pageLines: (from: number, to: number, total: number) => `${from}–${to} / ${total} 行`,
  nextPage: '下一页',
  sheets: '工作表',
  hidden: '（隐藏）',
  body: '正文',
  source: '源码',
  truncated: '当前展示文件开头。保存原件可查看完整内容。',
} as const;
