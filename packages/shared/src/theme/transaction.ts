/** 交易图的画布、边与证据检查器在桌面和离线报告中使用同一套明暗色阶。 */
export const TRANSACTION_THEME_TOKENS = {
  light: {
    'tx-paper': '#ffffff',
    'tx-canvas': '#f6f8fb',
    'tx-ink': '#162438',
    'tx-muted': '#52647a',
    'tx-line': '#d7dfe9',
    'tx-edge': '#677c99',
    'tx-grid': '#d1dae5',
    'tx-accent': '#3158ad',
    'tx-selected': '#eaf0ff',
    'tx-exception': '#92452f',
    'tx-external': '#246b62',
  },
  dark: {
    'tx-paper': '#192332',
    'tx-canvas': '#141e2c',
    'tx-ink': '#e7edf6',
    'tx-muted': '#acbacd',
    'tx-line': '#38465a',
    'tx-edge': '#9eafc5',
    'tx-grid': '#354259',
    'tx-accent': '#adc3ff',
    'tx-selected': '#293b5b',
    'tx-exception': '#efad93',
    'tx-external': '#9cdaca',
  },
} as const;
