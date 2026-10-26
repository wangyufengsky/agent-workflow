import {
  ATTACHMENT_BYTES_MAX,
  ATTACHMENTS_PER_INPUT_MAX,
  AttachmentLimit,
  AttachmentParseFailure,
  AttachmentRejection,
  OFFICE_ATTACHMENT_BYTES_MAX,
  OFFICE_CELLS_MAX,
  OFFICE_PREVIEW_ROWS,
  type OfficeMeta,
} from '@aw/shared';
import { formatBytes } from './common.ts';

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
  /** A Word or Excel file is read in the same request (39 §5). */
  reading: '正在读取…',
  /** The card's summary of what a Word or Excel attachment holds (39 §5). */
  summary: (meta: OfficeMeta) =>
    meta.format === 'docx'
      ? `Word · ${meta.chars.toLocaleString('zh-CN')} 字`
      : `Excel · ${meta.sheets.length} 个工作表 · ${meta.sheets.reduce((n, s) => n + s.rows, 0).toLocaleString('zh-CN')} 行`,
  /** Why an upload was refused, by the error's `details.reason` (39 §8.1). */
  failure: {
    [AttachmentRejection.NotText]: '目前支持文本、Word（.docx）和 Excel（.xlsx）文件，这个文件读不出文字。',
    [AttachmentRejection.LegacyOffice]:
      '不支持旧版 .doc / .xls，请在 Word、Excel 或 WPS 中另存为 .docx / .xlsx 后再上传。',
    [AttachmentRejection.Encrypted]: '文件有密码保护，请去掉打开密码后再上传。',
    [AttachmentRejection.Unsupported]: '暂不支持这种文件，目前支持文本、Word（.docx）和 Excel（.xlsx）。',
    [AttachmentLimit.Bytes]: `文件太大：文本不超过 ${formatBytes(ATTACHMENT_BYTES_MAX)}，Word / Excel 不超过 ${formatBytes(OFFICE_ATTACHMENT_BYTES_MAX)}。`,
    [AttachmentLimit.Count]: `每次最多附加 ${ATTACHMENTS_PER_INPUT_MAX} 个资料。`,
    [AttachmentLimit.Unzipped]: '文件解压后太大，可以删掉不需要的工作表或图片，或另存为 CSV。',
    [AttachmentLimit.Cells]: `表格超过 ${OFFICE_CELLS_MAX.toLocaleString('zh-CN')} 个有内容的单元格，可以删掉不需要的工作表，或另存为 CSV。`,
    [AttachmentParseFailure.Corrupt]: '文件已损坏或无法读取，可以在 Word / Excel 中打开后另存一份再试。',
    [AttachmentParseFailure.Timeout]: '读取这个文件用时太长，可以删掉不需要的工作表后再试，或另存为 CSV。',
    [AttachmentParseFailure.OutOfMemory]:
      '这个文件太复杂，读取时内存不够，可以删掉不需要的工作表后再试，或另存为 CSV。',
  } as Record<string, string>,
  /** Above the preview of a Word or Excel attachment (39 §8.1). */
  officeNote: '这是 AI 读到的内容；图片、图表、批注没有包含。',
  sheetsLabel: '工作表',
  hiddenSheet: (name: string) => `${name}（隐藏）`,
  row: '行',
  hiddenRow: (r: number) => `${r}（隐藏）`,
  emptySheet: '这个工作表是空的。',
  previewRows: (total: number) =>
    `只显示前 ${OFFICE_PREVIEW_ROWS.toLocaleString('zh-CN')} 行（共 ${total.toLocaleString('zh-CN')} 行），完整内容 AI 可以通过工具读取。`,
  wideSheet: '列太多，按单元格列出：',
  imageUnsupported: '暂不支持图片，请用文字描述截图里的内容。',
  tooMany: `每次最多附加 ${ATTACHMENTS_PER_INPUT_MAX} 个资料。`,
  notReady: '有资料还在上传或上传失败，处理好再发送。',
  removeFailed: '资料已从输入里移除，但后台没删掉；它会在 24 小时后自动清理。',
  size: formatBytes,
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
