import { z } from 'zod';
import { DeliveryStrategy, localMergeStrategySchema } from '../enums/git.ts';
import { BashPolicy, bashPolicySchema } from '../enums/system.ts';
import { ThemePreference, themePreferenceSchema, UiMode, uiModeSchema } from '../enums/ui.ts';

/** User settings (08 §4.3): key → value schema. Unknown keys are rejected. */
export const settingsSchema = z.strictObject({
  'ui.mode': uiModeSchema,
  'ui.theme': themePreferenceSchema,
  'ai.askOnUncertainty': z.boolean(),
  /** `provider/model`; null uses opencode's default model. */
  'ai.defaultModel': z.string().min(1).nullable(),
  'ai.bashPolicy': bashPolicySchema,
  'scheduler.maxConcurrentAttempts': z.number().int().min(1),
  'scheduler.maxConcurrentNodesPerTask': z.number().int().min(1),
  'node.maxAttempts': z.number().int().min(1),
  'attempt.timeoutMinutes': z.number().int().min(1),
  /** Absolute directory; null means `<data dir>/worktrees`. */
  'worktree.rootDir': z.string().min(1).nullable(),
  /** Strategy of the result card's primary「合并」button; pull requests have their own button. */
  'delivery.defaultStrategy': localMergeStrategySchema,
  'delivery.deleteBranchAfterMerge': z.boolean(),
  /** null looks the binary up on PATH and in `~/.opencode/bin`. */
  'opencode.binaryPath': z.string().min(1).nullable(),
  /** Operation ids the v1.1 assistant may run without confirmation (write risk only). */
  'assistant.alwaysAllow': z.array(z.string()),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;
export const SETTING_KEYS = settingsSchema.keyof().options;
export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const SETTING_DEFAULTS: Settings = {
  'ui.mode': UiMode.Simple,
  'ui.theme': ThemePreference.System,
  'ai.askOnUncertainty': false,
  'ai.defaultModel': null,
  'ai.bashPolicy': BashPolicy.Auto,
  'scheduler.maxConcurrentAttempts': 4,
  'scheduler.maxConcurrentNodesPerTask': 2,
  'node.maxAttempts': 3,
  'attempt.timeoutMinutes': 60,
  'worktree.rootDir': null,
  'delivery.defaultStrategy': DeliveryStrategy.Squash,
  'delivery.deleteBranchAfterMerge': true,
  'opencode.binaryPath': null,
  'assistant.alwaysAllow': [],
};

/** Lowest UI mode in which the settings page shows each key. */
export const SETTING_MODE: Record<SettingKey, UiMode> = {
  'ui.mode': UiMode.Simple,
  'ui.theme': UiMode.Simple,
  'ai.askOnUncertainty': UiMode.Simple,
  'ai.defaultModel': UiMode.Pro,
  'ai.bashPolicy': UiMode.Pro,
  'scheduler.maxConcurrentAttempts': UiMode.Simple,
  'scheduler.maxConcurrentNodesPerTask': UiMode.Pro,
  'node.maxAttempts': UiMode.Pro,
  'attempt.timeoutMinutes': UiMode.Pro,
  'worktree.rootDir': UiMode.Pro,
  'delivery.defaultStrategy': UiMode.Pro,
  'delivery.deleteBranchAfterMerge': UiMode.Pro,
  'opencode.binaryPath': UiMode.Pro,
  'assistant.alwaysAllow': UiMode.Simple,
};
