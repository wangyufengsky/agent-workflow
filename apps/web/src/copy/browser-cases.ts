import { type BrowserCaseAssertion, BrowserCaseChallenge, BrowserCaseOutcome } from '@aw/shared';

const actions = {
  check: '只检查',
  click: '点击',
  fill: '填写',
  select: '选择下拉项',
} as const;

const assertions = {
  visible: '元素可见',
  text: '文本包含',
  value: '字段值等于',
  path: '页面路径等于',
} as const;

export const BROWSER_CASE_COPY = {
  title: '浏览器测试用例',
  handoff: {
    heading: '测试暂停，等待你操作',
    open: '打开测试页签',
    reason: {
      [BrowserCaseChallenge.Login]: '等待登录',
      [BrowserCaseChallenge.Verification]: '等待完成验证',
    },
    take: '接管测试页签',
    resume: '验证完成，继续测试',
    reload: '重新加载测试页',
    desktop: '请在桌面应用中打开这个任务，在测试页签完成登录或验证码。',
    takeHint: '接管后可在当前测试页签提交登录或验证码，手动操作限定在测试站点。',
    activeHint: '请在下方完成登录或验证码，再点继续。测试会从暂停的位置继续。',
  },
  newCase: '新建用例',
  saveFromTask: '保存为用例',
  edit: '编辑用例',
  empty: '还没有保存用例。',
  name: '用例名称',
  save: '保存用例',
  run: '运行',
  rerun: '复跑本次用例版本',
  confirmRun: '确认并运行',
  approve: '我确认这是测试环境，并授权访问此地址及发送列出的写请求。',
  revision: (revision: number) => `版本 ${revision}`,
  step: (step: number) => `步骤 ${step}`,
  stepName: '步骤名称',
  addStep: '添加步骤',
  removeStep: '移除步骤',
  moveUp: '上移',
  moveDown: '下移',
  action: '操作',
  actions,
  assertion: '断言',
  assertions,
  actionSelector: '操作元素的 CSS 选择器',
  assertSelector: '待验证元素的 CSS 选择器',
  actionValue: '填写的内容或下拉选项',
  expectedValue: '预期值',
  expected: '预期',
  actual: '实际',
  missing: '未取得值',
  true: '可见',
  false: '不可见',
  selectorExample: '#order-status',
  opening: '打开测试页面',
  notRun: '未执行',
  noRequests: '本步骤没有记录到请求。',
  requests: '步骤请求',
  blockedRequest: '已拦截',
  failedRequest: '请求失败',
  pendingRequest: '无响应状态',
  evidence: '失败截图',
  saveEvidence: '下载截图',
  outcome: {
    [BrowserCaseOutcome.Passed]: '通过',
    [BrowserCaseOutcome.Failed]: '失败',
    [BrowserCaseOutcome.Blocked]: '阻塞',
  },
  expectation: (expect: BrowserCaseAssertion) =>
    [assertions[expect.kind], 'selector' in expect ? expect.selector : '', 'value' in expect ? expect.value : '']
      .filter(Boolean)
      .join(' · '),
} as const;
