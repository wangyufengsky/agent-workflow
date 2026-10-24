import { ThemeId } from '@aw/shared';
import type { ThemeDefinition } from './theme-definition.ts';
import { claudeCodeTheme } from './themes/claude-code.ts';
import { codexTheme } from './themes/codex.ts';
import { deepseekTheme } from './themes/deepseek.ts';
import { defaultTheme } from './themes/default.ts';
import { draculaTheme } from './themes/dracula.ts';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  [ThemeId.Default]: defaultTheme,
  [ThemeId.ClaudeCode]: claudeCodeTheme,
  [ThemeId.Codex]: codexTheme,
  [ThemeId.Deepseek]: deepseekTheme,
  [ThemeId.Dracula]: draculaTheme,
};
