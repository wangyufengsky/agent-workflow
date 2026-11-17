import { randomUUID } from 'node:crypto';
import {
  AppError,
  BrowserCaseChallenge,
  type BrowserCaseHandoff,
  type BrowserPolicy,
  ErrorCode,
  urlAccess,
} from '@aw/shared';
import { z } from 'zod';
import type { Tab } from './browser.tab.ts';

type Challenge = { reason: BrowserCaseChallenge; persistent: boolean; key: string };
type Handoff = {
  dto: BrowserCaseHandoff;
  tab: Tab;
  policy: () => BrowserPolicy;
  finish: () => void;
  fail: (err: AppError) => void;
  busy: boolean;
};

const detectedSchema = z.object({ reason: z.enum(BrowserCaseChallenge), persistent: z.boolean() }).nullable();

export async function detectCaseChallenge(tab: Tab): Promise<Challenge | null> {
  const key = `${tab.documentVersion()} ${tab.url()}`;
  if (tab.credentialsAsked() !== null) return { reason: BrowserCaseChallenge.Login, persistent: true, key };
  const detected = detectedSchema.parse(
    await tab.evaluate(`(() => {
    const visible = (selector) => [...document.querySelectorAll(selector)].some((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility === 'visible' && style.opacity !== '0';
    });
    if (visible('input[type=password], input[autocomplete=current-password]'))
      return { reason: 'login', persistent: true };
    if (visible('input[autocomplete=one-time-code], input[name=otp i], input[name*=captcha i]'))
      return { reason: 'verification', persistent: true };
    if (visible('[data-captcha], iframe[title*=captcha i], iframe[src*=captcha i], [data-sitekey]'))
      return { reason: 'verification', persistent: false };
    return null;
  })()`),
  );
  return detected === null ? null : { ...detected, key };
}

function manualPolicy(policy: BrowserPolicy): BrowserPolicy {
  const scope = policy.automation;
  if (scope === undefined) throw new Error('Browser case has no scoped policy');
  return { ...policy, automation: { ...scope, manual: true } };
}

export function createCaseHandoffs() {
  const waiting = new Map<string, Handoff>();

  function current(taskId: string, handoffId: string): Handoff {
    const handoff = waiting.get(taskId);
    if (handoff?.dto.id !== handoffId || handoff.busy)
      throw new AppError(ErrorCode.StateTransitionInvalid, 'The browser is no longer waiting for this handoff');
    return handoff;
  }

  return {
    get(taskId: string): BrowserCaseHandoff | undefined {
      return waiting.get(taskId)?.dto;
    },
    controls(tabId: string): boolean {
      return [...waiting.values()].some((handoff) => handoff.dto.tabId === tabId);
    },
    lost(tabId: string): void {
      for (const handoff of waiting.values()) {
        if (handoff.dto.tabId === tabId)
          handoff.fail(new AppError(ErrorCode.BrowserNotOpen, 'The browser test tab closed'));
      }
    },
    async wait(
      taskId: string,
      tab: Tab,
      policy: () => BrowserPolicy,
      step: number,
      reason: BrowserCaseChallenge,
      signal: AbortSignal,
    ): Promise<void> {
      signal.throwIfAborted();
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const dto = { id: randomUUID(), reason, step, tabId: tab.tabId, active: false };
      const onAbort = () => reject(signal.reason);
      waiting.set(taskId, { dto, tab, policy, finish: resolve, fail: reject, busy: false });
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await promise;
      } finally {
        signal.removeEventListener('abort', onAbort);
        waiting.delete(taskId);
      }
    },
    async take(taskId: string, handoffId: string): Promise<void> {
      const handoff = current(taskId, handoffId);
      if (handoff.dto.active) return;
      handoff.busy = true;
      try {
        await handoff.tab.setPolicy(manualPolicy(handoff.policy()));
        handoff.dto.active = true;
      } finally {
        handoff.busy = false;
      }
    },
    async resume(taskId: string, handoffId: string): Promise<void> {
      const handoff = current(taskId, handoffId);
      if (!handoff.dto.active)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'Take the browser tab before resuming');
      handoff.busy = true;
      try {
        await handoff.tab.settle();
        const remaining = await detectCaseChallenge(handoff.tab);
        if (remaining?.persistent === true)
          throw new AppError(ErrorCode.BrowserLoginRequired, 'Finish the login or code form before resuming');
        const policy = handoff.policy();
        if (urlAccess(handoff.tab.url(), policy) === null)
          throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'Return to the test site before resuming');
        await handoff.tab.setPolicy(policy);
        handoff.finish();
      } finally {
        handoff.busy = false;
      }
    },
  };
}
