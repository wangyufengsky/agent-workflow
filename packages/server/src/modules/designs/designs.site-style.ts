import type { ThemeId } from '@aw/shared';
import { THEMES, type ThemeTokenName } from '@aw/shared/theme';

const offlineTokens = [
  'bg',
  'surface',
  'ink',
  'muted',
  'accent',
  'line',
  'bg-sunken',
] as const satisfies readonly ThemeTokenName[];

/** 样式随站点写出，使用与应用一致的主题值，无需在离线浏览器加载运行时。 */
export function designSiteStylesheet(id: ThemeId, stylesheet: string): string {
  const { colorScheme, tokens } = THEMES[id];
  const variables = offlineTokens.map((name) => `  --${name}: ${tokens[name]};`).join('\n');
  return `:root {\n  color-scheme: ${colorScheme};\n${variables}\n}\n${stylesheet}`;
}
