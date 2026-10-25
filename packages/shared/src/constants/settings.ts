import { z } from 'zod';
import { siteRuleSchema } from '../browser/policy.ts';
import { SiteAccess } from '../enums/browser.ts';
import { DeliveryStrategy, localMergeStrategySchema } from '../enums/git.ts';
import { BashPolicy, bashPolicySchema } from '../enums/system.ts';
import {
  CompanionAppearance,
  companionAppearanceSchema,
  ThemePreference,
  themePreferenceSchema,
  UiMode,
  uiModeSchema,
} from '../enums/ui.ts';

/** One or more PEM certificates (D164); the backend parses each before saving (Node's X509 is not here). */
const pemCertificatesSchema = z
  .string()
  .regex(/^\s*(-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*)+$/);

/**
 * `http(s)://host[:port]` and nothing else (D165): no user name or password in any spelling, as the settings are stored
 * in plain text (06 §11). The whole value is matched because this package has no URL parser to ask.
 */
const proxyUrlSchema = z
  .url({ protocol: /^https?$/ })
  .regex(/^https?:\/\/[^\s/?#@\\]+\/?$/i, 'A proxy URL in the settings is http(s)://host[:port] only');

/** User settings (08 §4.3): key → value schema. Unknown keys are rejected. */
export const settingsSchema = z.strictObject({
  'ui.mode': uiModeSchema,
  'ui.theme': themePreferenceSchema,
  /** Play the opening animation when the app starts (28 §5, D113); takes effect at the next start. */
  'ui.introAnimation': z.boolean(),
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
  /** No internet here (intranet, D168): opencode starts without what needs it; applies at its next start. */
  'network.offline': z.boolean(),
  /** Operation ids the v1.1 assistant may run without confirmation (write risk only). */
  'assistant.alwaysAllow': z.array(z.string()),
  'companion.enabled': z.boolean(),
  'companion.appearance': companionAppearanceSchema,
  'companion.animations': z.boolean(),
  'companion.size': z.number().int().min(120).max(300),
  'companion.whisper': z.boolean(),
  'companion.whisperMinutes': z.number().int().min(1).max(120),
  'companion.notifications': z.boolean(),
  /** Page previews running at once (29 §4.4); dev servers are memory-hungry. */
  'preview.maxRunning': z.number().int().min(1),
  /** A preview with no browser tab and no active attempt stops after this long (29 §4.2). */
  'preview.idleMinutes': z.number().int().min(1),
  /** Website rules in order (29 §5.4); a site no rule matches cannot be opened. */
  'browser.sites': z.array(siteRuleSchema),
  /** Host or path fragments that mark a login page, besides the built-in ones (29 §5.4). */
  'browser.loginUrlPatterns': z.array(z.string().min(1)),
  /** CAs trusted besides the built-in roots and the system store (D164); null: none. */
  'network.extraCaCerts': pemCertificatesSchema.nullable(),
  /** Replaces the proxy environment variables when set (D165); null: they apply. */
  'network.proxy': proxyUrlSchema.nullable(),
  /** Hosts reached directly while `network.proxy` is set; `.corp.example` also matches its subdomains. */
  'network.noProxy': z.array(z.string().regex(/^[^\s,]+$/)),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;
export const SETTING_KEYS = settingsSchema.keyof().options;
export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const SETTING_DEFAULTS: Settings = {
  'ui.mode': UiMode.Simple,
  'ui.theme': ThemePreference.System,
  'ui.introAnimation': true,
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
  'network.offline': false,
  'assistant.alwaysAllow': [],
  'companion.enabled': false,
  'companion.appearance': CompanionAppearance.Orb,
  'companion.animations': true,
  'companion.size': 180,
  'companion.whisper': false,
  'companion.whisperMinutes': 15,
  'companion.notifications': true,
  'preview.maxRunning': 3,
  'preview.idleMinutes': 10,
  'browser.sites': [{ pattern: '*', access: SiteAccess.Read }],
  'browser.loginUrlPatterns': [],
  'network.extraCaCerts': null,
  'network.proxy': null,
  'network.noProxy': [],
};

/** Lowest UI mode in which the settings page shows each key. */
export const SETTING_MODE: Record<SettingKey, UiMode> = {
  'ui.mode': UiMode.Simple,
  'ui.theme': UiMode.Simple,
  'ui.introAnimation': UiMode.Simple,
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
  'network.offline': UiMode.Simple,
  'assistant.alwaysAllow': UiMode.Simple,
  'companion.enabled': UiMode.Simple,
  'companion.appearance': UiMode.Simple,
  'companion.animations': UiMode.Simple,
  'companion.size': UiMode.Simple,
  'companion.whisper': UiMode.Simple,
  'companion.whisperMinutes': UiMode.Simple,
  'companion.notifications': UiMode.Simple,
  'preview.maxRunning': UiMode.Pro,
  'preview.idleMinutes': UiMode.Pro,
  'browser.sites': UiMode.Simple,
  'browser.loginUrlPatterns': UiMode.Pro,
  'network.extraCaCerts': UiMode.Pro,
  'network.proxy': UiMode.Pro,
  'network.noProxy': UiMode.Pro,
};
