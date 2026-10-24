import { ThemeId } from '@aw/shared';
import type { ThemeDefinition } from './theme-definition.ts';
import { claudeCodeTheme } from './themes/claude-code.ts';
import { codexTheme } from './themes/codex.ts';
import { deepseekTheme } from './themes/deepseek.ts';
import { defaultTheme } from './themes/default.ts';
import { spdbTheme } from './themes/spdb.ts';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  [ThemeId.Default]: defaultTheme,
  [ThemeId.ClaudeCode]: claudeCodeTheme,
  [ThemeId.Spdb]: spdbTheme,
  [ThemeId.Codex]: codexTheme,
  [ThemeId.Deepseek]: deepseekTheme,
};
