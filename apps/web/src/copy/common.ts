const DATE_TIME = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
const DATE_TIME_SECONDS = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
const TIME = new Intl.DateTimeFormat('zh-CN', { timeStyle: 'short' });
const MONTH_DAY = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

/** Every date shown in the app is formatted here, in the interface's language rather than the system locale. */
export const formatDateTime = (ms: number) => DATE_TIME.format(ms);
export const formatDateTimeSeconds = (ms: number) => DATE_TIME_SECONDS.format(ms);
export const formatTime = (ms: number) => TIME.format(ms);
/** `10月22日周四`: a day heading. */
export const formatMonthDay = (ms: number) => MONTH_DAY.format(ms);

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
/** A file or download size: `512 B`, `12 KB`, `3.4 MB`, `1.2 GB`. */
export const formatBytes = (bytes: number) =>
  bytes < KB
    ? `${bytes} B`
    : bytes < MB
      ? `${Math.round(bytes / KB)} KB`
      : bytes < GB
        ? `${(bytes / MB).toFixed(1)} MB`
        : `${(bytes / GB).toFixed(1)} GB`;

export const COMMON_COPY = {
  loading: '正在加载…',
  retry: '重试',
  loadMore: '加载更多',
  cancel: '取消',
  close: '关闭',
  save: '保存',
  saved: '已保存',
  confirm: '确定',
  errorDetails: '技术详情',
  backendUnreachable: '无法连接后台服务。',
  proOnlyTitle: '此页面属于专业模式',
  proOnlyBody: '开启专业模式后可以使用流程编排、Git 工作台、角色与数据库等功能。',
  enablePro: '开启专业模式',
  themeSwitch: '切换主题',
} as const;
