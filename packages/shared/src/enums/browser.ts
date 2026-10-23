import { z } from 'zod';

/** A task worktree's page preview (29 §4.2): in memory only, changed through `previewMachine`. */
export const PreviewState = {
  Stopped: 'stopped',
  Starting: 'starting',
  Running: 'running',
  Failed: 'failed',
} as const;
export type PreviewState = (typeof PreviewState)[keyof typeof PreviewState];
export const previewStateSchema = z.enum(PreviewState);

/** Who a browser tab belongs to (29 §5.3). */
export const BrowserSessionKind = {
  /** The user's own preview tab on the task page. */
  User: 'user',
  /** An attempt's browser tools. */
  Attempt: 'attempt',
  /** A page check. */
  Check: 'check',
  /** Website login, the assistant reading a page, a PPT web material. */
  Site: 'site',
} as const;
export type BrowserSessionKind = (typeof BrowserSessionKind)[keyof typeof BrowserSessionKind];

/** The two tabs an attempt may have (29 §5.3): its task's preview, or a website. */
export const BrowserTabKind = {
  Preview: 'preview',
  Site: 'site',
} as const;
export type BrowserTabKind = (typeof BrowserTabKind)[keyof typeof BrowserTabKind];
export const browserTabKindSchema = z.enum(BrowserTabKind);

/** What a website rule allows the AI (29 §5.4). */
export const SiteAccess = {
  /** Browse only: the AI tab's non-GET requests and WebSockets to the site are cancelled. */
  Read: 'read',
  /** Everything, as the logged-in user. */
  Interact: 'interact',
} as const;
export type SiteAccess = (typeof SiteAccess)[keyof typeof SiteAccess];
export const siteAccessSchema = z.enum(SiteAccess);

/** Viewport presets (`VIEWPORT_SIZES`). */
export const ViewportPreset = {
  Desktop: 'desktop',
  Tablet: 'tablet',
  Mobile: 'mobile',
} as const;
export type ViewportPreset = (typeof ViewportPreset)[keyof typeof ViewportPreset];
export const viewportPresetSchema = z.enum(ViewportPreset);

/** `BROWSER_ACTION_FAILED.details.reason` (29 §5.5). */
export const BrowserActionFailure = {
  NotVisible: 'not_visible',
  Covered: 'covered',
  Disabled: 'disabled',
  Detached: 'detached',
  NotFocusable: 'not_focusable',
} as const;
export type BrowserActionFailure = (typeof BrowserActionFailure)[keyof typeof BrowserActionFailure];

/** Why a request from a browser tab was cancelled (29 §5.4). */
export const BrowserBlockReason = {
  /** Neither the preview nor a website rule allows the address. */
  NotAllowed: 'not_allowed',
  /** A write (non-GET request or WebSocket) to a read-only website from an AI tab. */
  ReadOnly: 'read_only',
} as const;
export type BrowserBlockReason = (typeof BrowserBlockReason)[keyof typeof BrowserBlockReason];
export const browserBlockReasonSchema = z.enum(BrowserBlockReason);
