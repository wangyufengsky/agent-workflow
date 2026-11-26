import { SYSTEM_THEME_MAP, type ThemeId } from '@aw/shared';
import { DESIGN_CODE_TOKENS, THEMES, type ThemeTokenName, TRANSACTION_THEME_TOKENS } from '@aw/shared/theme';

const offlineTokens = [
  'bg',
  'surface',
  'ink',
  'muted',
  'accent',
  'line',
  'bg-sunken',
  'accent-fill',
  'ok',
  'warn',
] as const satisfies readonly ThemeTokenName[];

function themeRule(selector: string, id: ThemeId): string {
  const { colorScheme, tokens } = THEMES[id];
  const variables = [
    ...offlineTokens.map((name) => [name, tokens[name]]),
    ...Object.entries(DESIGN_CODE_TOKENS[colorScheme]),
    ...Object.entries(TRANSACTION_THEME_TOKENS[colorScheme]),
  ]
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');
  return `${selector} {\n  color-scheme: ${colorScheme};\n${variables}\n}\n`;
}

/** 离线站点根据系统明暗选择应用的对应调色板。 */
export function designSiteStylesheet(stylesheet: string): string {
  const light = themeRule(':root', SYSTEM_THEME_MAP.light);
  const dark = themeRule(':root', SYSTEM_THEME_MAP.dark);
  return `${light}@media (prefers-color-scheme: dark) {\n${dark}}\n${stylesheet}`;
}
