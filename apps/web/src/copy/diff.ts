import { DiffFileStatus } from '@aw/shared';

export const DIFF_COPY = {
  unified: '合并视图',
  split: '并排视图',
  viewMode: '显示方式',
  files: '改动文件',
  noFiles: '没有改动。',
  pickFile: '选择左侧的文件查看改动。',
  binary: '二进制文件，不显示内容。',
  empty: '这个文件没有内容改动（可能只改了权限或被重命名）。',
  tooLarge: (kb: number) => `文件改动过大（${kb} KB），不在这里显示。`,
  loading: '正在载入改动…',
  status: {
    [DiffFileStatus.Added]: '新增',
    [DiffFileStatus.Modified]: '修改',
    [DiffFileStatus.Deleted]: '删除',
    [DiffFileStatus.Renamed]: '重命名',
  },
  binaryStat: '二进制',
} as const;
