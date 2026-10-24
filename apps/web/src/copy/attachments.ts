import { ATTACHMENTS_PER_INPUT_MAX } from '@aw/shared';

/** The attachment bar and its dialogs (30 §2). */
export const ATTACHMENTS_COPY = {
  add: '添加资料',
  addProjectFile: '项目文件',
  /** The same two in the input's「+」menu (36 §4). */
  menuUpload: '上传文件…',
  menuProjectFile: '项目文件…',
  listLabel: '附加的资料',
  remove: (name: string) => `移除 ${name}`,
  open: (name: string) => `查看 ${name}`,
  uploading: '上传中…',
  imageUnsupported: '暂不支持图片，请用文字描述截图里的内容。',
  tooMany: `每次最多附加 ${ATTACHMENTS_PER_INPUT_MAX} 个资料。`,
  notReady: '有资料还在上传或上传失败，处理好再发送。',
  removeFailed: '资料已从输入里移除，但后台没删掉；它会在 24 小时后自动清理。',
  size: (bytes: number) =>
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`,
  fromProject: (path: string) => `项目文件 ${path}`,
  fromUpload: '上传的文件',
  loading: '正在读取…',
  close: '关闭',
  projectFileTitle: '添加项目文件',
  projectFileMain: '读取项目主目录里的文件；之后文件再变化，附件不会跟着变。',
  projectFileTask: '读取这个任务工作区里的文件；之后文件再变化，附件不会跟着变。',
  root: '根目录',
  openDir: (name: string) => `打开 ${name}`,
  emptyDir: '这个目录是空的。',
  selected: (path: string) => `已选：${path}`,
  noneSelected: '在上面选一个文件。',
  linesFrom: '从第几行（可选）',
  linesTo: '到第几行（可选）',
  addSelected: '添加',
  sentTitle: '资料',
} as const;
