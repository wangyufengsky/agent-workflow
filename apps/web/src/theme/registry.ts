import { ThemeId } from '@aw/shared';
import type { ThemeDefinition } from './theme-definition.ts';
import { deepseekTheme } from './themes/deepseek.ts';
import { githubWhiteTheme } from './themes/github-white.ts';
import { spdbTheme } from './themes/spdb.ts';
import { warmTheme } from './themes/warm.ts';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  [ThemeId.Deepseek]: deepseekTheme,
  [ThemeId.Warm]: warmTheme,
  [ThemeId.Spdb]: spdbTheme,
  [ThemeId.GithubWhite]: githubWhiteTheme,
};
