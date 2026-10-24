import { ThemePreference } from '@aw/shared';

export const THEME_LABEL: Record<ThemePreference, string> = {
  [ThemePreference.Default]: '默认',
  [ThemePreference.ClaudeCode]: 'Claude Code',
  [ThemePreference.Codex]: 'Codex',
  [ThemePreference.Deepseek]: 'DeepSeek',
  [ThemePreference.Dracula]: 'Dracula',
  [ThemePreference.System]: '跟随系统',
};
