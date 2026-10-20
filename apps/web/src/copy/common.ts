const DATE_TIME = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
const DATE_TIME_SECONDS = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
const TIME_SECONDS = new Intl.DateTimeFormat('zh-CN', { timeStyle: 'medium' });

/** Every date shown in the app is formatted here, in the interface's language rather than the system locale. */
export const formatDateTime = (ms: number) => DATE_TIME.format(ms);
export const formatDateTimeSeconds = (ms: number) => DATE_TIME_SECONDS.format(ms);
export const formatTimeSeconds = (ms: number) => TIME_SECONDS.format(ms);

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
  proOnlyBody: '开启专业模式后可以使用流程编排、Git 管理台、角色与数据库等功能。',
  enablePro: '开启专业模式',
  themeSwitch: '切换主题',
} as const;
