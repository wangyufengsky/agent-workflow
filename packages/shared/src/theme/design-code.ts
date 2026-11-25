/** 代码一律使用深色面板，按页面明暗分别调节底色和证据标记。 */
const syntax = {
  'design-code-ink': '#E5EDF8',
  'design-code-muted': '#A8B8CE',
  'design-code-keyword': '#C8B7FF',
  'design-code-string': '#AAE2B4',
  'design-code-number': '#FFD18C',
  'design-code-function': '#8BDCF4',
  'design-code-error': '#FFB2B9',
  'design-code-focus-mark': '#9BB8FF',
} as const;

export const DESIGN_CODE_TOKENS = {
  light: {
    ...syntax,
    'design-code-bg': '#172235',
    'design-code-line': '#486181',
    'design-code-focus': '#293E60',
  },
  dark: {
    ...syntax,
    'design-code-bg': '#0E1520',
    'design-code-line': '#394D68',
    'design-code-focus': '#223953',
  },
} as const;
