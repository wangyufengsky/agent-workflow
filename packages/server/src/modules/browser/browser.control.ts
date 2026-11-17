import { createHash, randomUUID } from 'node:crypto';
import {
  AppError,
  type AssistantBrowserAction,
  type BrowserPolicy,
  type BrowserWriteRule,
  browserWriteRuleSchema,
  ErrorCode,
  urlAccess,
} from '@aw/shared';
import type { Logger } from '../../core/logger.ts';
import type { createActions } from './browser.actions.ts';
import { NO_REALTIME, type Tab } from './browser.tab.ts';

type Target = { tab: Tab; origin: string; restore: () => BrowserPolicy };
type Actions = ReturnType<typeof createActions>;
type Pending = {
  requestId: string;
  url: string;
  version: number;
  state: string;
  input: AssistantBrowserAction;
};
type Grant = Target & {
  conversationId: string;
  state: 'starting' | 'ready' | 'revoked';
  work: Promise<unknown>;
  busy: boolean;
  pending?: Pending;
  script?: string;
};

function stale(message: string): never {
  throw new AppError(ErrorCode.BrowserRefStale, message);
}

const restricted = ({ origin }: Target, writes: BrowserWriteRule[] = []): BrowserPolicy => ({
  previewOrigins: [origin],
  sites: [],
  automation: { origin, writes },
});

export function createBrowserControl(actions: Actions, log: Logger) {
  const grants = new Map<string, Grant>();

  async function revoke(conversationId: string): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const grant of grants.values()) {
      if (grant.conversationId !== conversationId || grant.state === 'revoked') continue;
      grant.state = 'revoked';
      delete grant.pending;
      const restrictedNow = grant.tab
        .setPolicy(restricted(grant))
        .catch((err: unknown) => log.warn({ err }, 'could not restrict the revoked preview'));
      pending.push(
        Promise.allSettled([grant.work, restrictedNow])
          .then(async () => {
            if (grant.script !== undefined) {
              await grant.tab.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: grant.script });
            }
            await grant.tab.setPolicy(grant.restore());
          })
          .catch((err: unknown) => log.warn({ err }, 'could not restore the preview policy'))
          .finally(() => grants.delete(grant.tab.tabId)),
      );
    }
    await Promise.all(pending);
  }

  function check(grant: Grant): void {
    if (grant.state !== 'ready' || urlAccess(grant.tab.url(), restricted(grant)) === null) {
      throw new AppError(ErrorCode.BrowserNotOpen, 'Enable control on the selected project preview first');
    }
  }

  function current(conversationId: string): Grant {
    const grant = [...grants.values()].find((item) => item.conversationId === conversationId && item.state === 'ready');
    if (grant === undefined) throw new AppError(ErrorCode.BrowserNotOpen, 'The user has not enabled preview control');
    check(grant);
    if (grant.busy) throw new AppError(ErrorCode.BrowserActionFailed, 'Another action is running on this preview');
    return grant;
  }

  async function describe(grant: Grant, input: AssistantBrowserAction) {
    const { action } = input;
    check(grant);
    const url = grant.tab.url();
    const version = grant.tab.documentVersion();
    const element = await actions.describeControl(grant.tab, 'ref' in action ? action.ref : null);
    if (element.sensitive || grant.tab.credentialsAsked() !== null) {
      throw new AppError(
        ErrorCode.BrowserLoginRequired,
        'The user handles passwords, verification codes and file inputs',
      );
    }
    if (action.kind === 'type' && !element.textField)
      throw new AppError(ErrorCode.BrowserActionFailed, 'Choose an editable text field');
    check(grant);
    if (url !== grant.tab.url() || version !== grant.tab.documentVersion()) stale('The page changed; read it again');
    return {
      url,
      version,
      element,
      state: createHash('sha256')
        .update(JSON.stringify([element, 'ref' in action ? grant.tab.refOf(action.ref) : null]))
        .digest('hex'),
    };
  }

  async function run(grant: Grant, pending: Pending) {
    const { tab } = grant;
    const { action } = pending.input;
    const verify = async () => {
      const now = await describe(grant, pending.input);
      if (pending.url !== now.url || pending.version !== now.version || pending.state !== now.state) {
        stale('The page, target or form changed after the operation was prepared');
      }
    };

    const work = (async () => {
      await verify();
      tab.begin();
      // 核对页面和目标后，仅在这次动作执行期间放行已确认的写请求。
      const beforeInput = async () => {
        await verify();
        if (pending.input.write !== undefined) await tab.setPolicy(restricted(grant, [pending.input.write]));
        check(grant);
      };
      try {
        switch (action.kind) {
          case 'click':
            await actions.click(tab, action.ref, beforeInput);
            break;
          case 'press':
            await beforeInput();
            await actions.press(tab, action.key);
            break;
          case 'type':
            await actions.type(tab, action.ref, { ...action, submit: false }, beforeInput);
            break;
          case 'select':
            await actions.select(tab, action.ref, action.values, beforeInput);
            break;
        }
        return await tab.result(await tab.settle());
      } finally {
        if (pending.input.write !== undefined) await tab.setPolicy(restricted(grant));
      }
    })();
    grant.busy = true;
    grant.work = work;
    try {
      return await work;
    } finally {
      grant.busy = false;
    }
  }

  return {
    revoke,
    hasPolicy: (tabId: string) => grants.has(tabId),

    async enable(conversationId: string, target: Target) {
      const { tab } = target;
      const existing = grants.get(tab.tabId);
      if (existing?.conversationId === conversationId && existing.state === 'ready') return;
      if (existing !== undefined)
        throw new AppError(ErrorCode.BrowserActionFailed, 'Preview control is being released');
      if (urlAccess(tab.url(), restricted(target)) === null)
        throw new AppError(ErrorCode.BrowserNotOpen, 'Open a page on the project preview origin first');
      const grant: Grant = { ...target, conversationId, state: 'starting', work: Promise.resolve(), busy: false };
      grants.set(tab.tabId, grant);
      grant.work = (async () => {
        await tab.setPolicy(restricted(grant));
        const result = await tab.cdp('Page.addScriptToEvaluateOnNewDocument', { source: NO_REALTIME });
        if (
          typeof result === 'object' &&
          result !== null &&
          'identifier' in result &&
          typeof result.identifier === 'string'
        )
          grant.script = result.identifier;
        tab.begin();
        const previous = tab.documentVersion();
        await tab.cdp('Page.reload', { ignoreCache: true });
        if (!(await tab.waitForDocument(previous))) stale('The selected preview could not reload');
        await tab.settle();
        if (grant.state !== 'starting') throw new AppError(ErrorCode.BrowserNotOpen, 'The selected preview changed');
        grant.state = 'ready';
        check(grant);
      })();
      try {
        await grant.work;
      } catch (err) {
        await revoke(conversationId);
        throw err;
      }
    },

    async prepare(conversationId: string, input: AssistantBrowserAction) {
      const grant = current(conversationId);
      const { url, version, element, state } = await describe(grant, input);
      if (current(conversationId) !== grant) stale('The preview authorization changed');
      delete grant.pending;
      const { action } = input;
      const submits =
        (action.kind === 'click' && element.submit) || (action.kind === 'press' && action.key === 'Enter');
      if (
        input.write === undefined &&
        submits &&
        element.formAction !== null &&
        urlAccess(element.formAction, restricted(grant)) !== null
      ) {
        const inferred = browserWriteRuleSchema.safeParse({
          method: element.formMethod?.toUpperCase(),
          path: new URL(element.formAction).pathname,
        });
        if (inferred.success) input = { ...input, write: inferred.data };
      }
      const pending = { requestId: randomUUID(), url, version, state, input };
      const safeLink = element.link !== null && urlAccess(element.link, restricted(grant)) !== null;
      if (
        input.write === undefined &&
        (action.kind === 'type' || action.kind === 'select' || (action.kind === 'click' && safeLink))
      ) {
        return { output: await run(grant, pending) } as const;
      }
      grant.pending = pending;
      const page = new URL(url);
      const fields = element.fields;
      if (action.kind === 'type') fields.push(action.text.slice(0, 200));
      if (action.kind === 'select') fields.push(...action.values.map((value) => value.slice(0, 200)));
      return {
        confirmation: {
          requestId: pending.requestId,
          page: page.origin + page.pathname,
          target: action.kind === 'press' ? `${action.key} · ${element.label}` : element.label,
          fields,
          ...(input.write === undefined ? {} : { write: input.write }),
        },
      } as const;
    },

    confirm(conversationId: string, requestId: string) {
      const grant = current(conversationId);
      const { pending } = grant;
      if (pending === undefined || pending.requestId !== requestId) stale('The operation expired; read the page again');
      delete grant.pending;
      return run(grant, pending);
    },
  };
}
