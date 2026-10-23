import { z } from 'zod';
import { browserPolicySchema } from '../browser/policy.ts';
import { browserBlockReasonSchema } from '../enums/browser.ts';

/**
 * Backend (utilityProcess) ↔ Electron main messages for browser tabs (29 §5.1). Main holds the views, relays CDP and
 * cancels requests by the policy it is given; what to open, when a page has settled and what a click hit are the
 * backend's to decide.
 */
const tabIdSchema = z.string().min(1);

export const browserPortOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('open'),
    tabId: tabIdSchema,
    partition: z.string().min(1),
    /**
     * The user's own tabs are placed on the window by the renderer, write as the user does, and hand addresses the
     * policy denies to the system browser. The AI's and the checks' tabs render offscreen, and their writes to
     * read-only websites are cancelled.
     */
    userFacing: z.boolean(),
    /**
     * Set through device metrics: an offscreen view has no size of its own (29 §12 V1). Null for a user-facing tab,
     * which takes the size of the area the renderer places it in.
     */
    viewport: z
      .object({ width: z.number().int().min(1), height: z.number().int().min(1), mobile: z.boolean() })
      .nullable(),
    policy: browserPolicySchema,
  }),
  /** The preview's origin changes when it restarts on another port. */
  z.object({ kind: z.literal('setPolicy'), tabId: tabIdSchema, policy: browserPolicySchema }),
  z.object({ kind: z.literal('close'), tabId: tabIdSchema }),
  z.object({
    kind: z.literal('cdp'),
    tabId: tabIdSchema,
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    /** A child target's session (cross-origin frames). */
    sessionId: z.string().optional(),
  }),
]);
export type BrowserPortOp = z.infer<typeof browserPortOpSchema>;

export const browserPortRequestSchema = z.object({
  type: z.literal('browser.request'),
  id: z.number().int(),
  op: browserPortOpSchema,
});
export type BrowserPortRequest = z.infer<typeof browserPortRequestSchema>;

export const browserPortResponseSchema = z.discriminatedUnion('ok', [
  /** `open` / `setPolicy` / `close`: null; `cdp`: the command's result. */
  z.object({ type: z.literal('browser.response'), id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.object({ type: z.literal('browser.response'), id: z.number().int(), ok: z.literal(false), error: z.string() }),
]);
export type BrowserPortResponse = z.infer<typeof browserPortResponseSchema>;

/** Main → backend, unasked. CDP events come only for the domains the backend enabled. */
export const browserPortEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('browser.cdpEvent'),
    tabId: tabIdSchema,
    method: z.string(),
    params: z.unknown(),
    sessionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('browser.blocked'),
    tabId: tabIdSchema,
    url: z.string(),
    method: z.string(),
    reason: browserBlockReasonSchema,
  }),
  /** The tab's renderer is gone or the view was destroyed; the backend drops the tab. */
  z.object({ type: z.literal('browser.gone'), tabId: tabIdSchema, reason: z.string() }),
]);
export type BrowserPortEvent = z.infer<typeof browserPortEventSchema>;
