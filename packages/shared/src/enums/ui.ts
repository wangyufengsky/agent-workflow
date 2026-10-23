import { z } from 'zod';

export const CompanionAppearance = { Orb: 'orb', Whale: 'whale' } as const;
export type CompanionAppearance = (typeof CompanionAppearance)[keyof typeof CompanionAppearance];
export const companionAppearanceSchema = z.enum(CompanionAppearance);

export const UiMode = {
  Simple: 'simple',
  Pro: 'pro',
} as const;
export type UiMode = (typeof UiMode)[keyof typeof UiMode];
export const uiModeSchema = z.enum(UiMode);

export const ThemeId = {
  Deepseek: 'deepseek',
  Warm: 'warm',
  Spdb: 'spdb',
  GithubWhite: 'github_white',
} as const;
export type ThemeId = (typeof ThemeId)[keyof typeof ThemeId];
export const THEME_IDS = Object.values(ThemeId);
export const themeIdSchema = z.enum(ThemeId);

export const ThemePreference = {
  ...ThemeId,
  System: 'system',
} as const;
export type ThemePreference = (typeof ThemePreference)[keyof typeof ThemePreference];
export const themePreferenceSchema = z.enum(ThemePreference);

/** Theme used for each OS colour scheme when the preference is `system`. */
export const SYSTEM_THEME_MAP = {
  dark: ThemeId.Deepseek,
  light: ThemeId.GithubWhite,
} as const satisfies Record<'dark' | 'light', ThemeId>;

/** Status colour tone; each maps to theme tokens `--{tone}`, `--{tone}-fill`, `--{tone}-line`. */
export const StatusTone = {
  Idle: 'idle',
  Run: 'run',
  Wait: 'wait',
  Warn: 'warn',
  Ok: 'ok',
  Done: 'done',
  Danger: 'danger',
} as const;
export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];
export const STATUS_TONES = Object.values(StatusTone);
