import { STORAGE_KEEP_DAYS, StorageCleanTarget, StorageKind } from '@aw/shared';

export const STORAGE_COPY = {
  title: '存储空间',
  refresh: '重新统计',
  measuring: '正在统计…（任务工作区较大时需要一会儿）',
  total: (size: string) => `共 ${size}`,
  dataDir: '数据目录',
  worktreeRoot: '任务工作区目录',
  kind: {
    [StorageKind.Database]: '数据库',
    [StorageKind.Logs]: '日志',
    [StorageKind.Transcripts]: '会话记录与截图',
    [StorageKind.Worktrees]: '任务工作区',
    [StorageKind.Assistant]: '助手文件与对话',
    [StorageKind.Attachments]: '附件',
    [StorageKind.Other]: '其他',
  } satisfies Record<StorageKind, string>,
  worktreesHint: '任务工作区在任务合并或放弃后自动删除；残留的可在 Git 工作台的工作区总览里清理。',
  cleanupTitle: '清理',
  target: {
    [StorageCleanTarget.Logs]: {
      label: `${STORAGE_KEEP_DAYS} 天前的日志`,
      detail: (count: number, size: string) => (count === 0 ? '没有可清理的日志' : `${count} 个文件，${size}`),
      confirmTitle: '清理旧日志？',
      confirmBody: `将删除 ${STORAGE_KEEP_DAYS} 天前的应用日志与 opencode 日志，正在使用的日志保留。删除后不能恢复。`,
    },
    [StorageCleanTarget.Transcripts]: {
      label: `${STORAGE_KEEP_DAYS} 天前结束的任务的会话记录`,
      detail: (count: number, size: string) => (count === 0 ? '没有可清理的会话记录' : `${count} 个任务，${size}`),
      confirmTitle: '清理旧会话记录？',
      confirmBody: `将删除 ${STORAGE_KEEP_DAYS} 天前已完成或已取消的任务的会话回放、页面截图与预览日志。任务、结果卡、改动与分支都保留，但这些任务的步骤将不能再查看会话回放。删除后不能恢复。`,
    },
  } satisfies Record<StorageCleanTarget, unknown>,
  clean: '清理',
  confirm: '删除',
  cleaned: (size: string) => `已释放 ${size}`,
} as const;
