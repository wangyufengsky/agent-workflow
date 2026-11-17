import { createHash, randomUUID } from 'node:crypto';
import {
  AppError,
  type AssistantBrowserAction,
  type AssistantBrowserActivity,
  AssistantBrowserActivityKind,
  AssistantBrowserActivityOutcome,
  AssistantBrowserMode,
  type BrowserPolicy,
  type BrowserWriteRule,
  browserWriteRuleSchema,
  ErrorCode,
  looksLikeBrowserMutation,
  urlAccess,
} from '@aw/shared';
import type { Logger } from '../../core/logger.ts';
import type { createActions } from './browser.actions.ts';
import { NO_REALTIME, type Tab } from './browser.tab.ts';

export type BrowserActivity = {
  updated(conversationId: string): void;
  list(conversationId: string): AssistantBrowserActivity[];
  record(conversationId: string, record: Omit<AssistantBrowserActivity, 'id' | 'at'>): void;
};

type Target = { tab: Tab; origin: string; restore: () => BrowserPolicy };
type Actions = ReturnType<typeof createActions>;
type Pending = {
  requestId: string;
  target: string;
  epoch: number;
  url: string;
  version: number;
  state: string;
  input: AssistantBrowserAction;
};
type Grant = Target & {
  conversationId: string;
  state: 'starting' | 'ready' | 'taking' | 'manual' | 'returning' | 'revoked';
  work: Promise<unknown>;
  busy: boolean;
  pending?: Pending;
  script?: string;
};

function stale(message: string): never {
  throw new AppError(ErrorCode.BrowserRefStale, message);
}

const restricted = (
  { origin }: Target,
  writes: BrowserWriteRule[] = [],
  mode: 'restricted' | 'confirmed' | 'manual' = 'restricted',
): BrowserPolicy => ({
  previewOrigins: [origin],
  sites: [],
  automation: {
    origin,
    writes,
    restrictMutationReads: mode === 'restricted',
    ...(mode === 'manual' ? { manual: true } : {}),
  },
});

const LOW_RISK_BUTTON =
  /^(?:筛选|应用筛选|过滤|查询|搜索|查看|查看详情|详情|显示详情|展开|折叠|收起|下一页|上一页|filter|apply filters?|search|view|view details|show details|expand|collapse|next page|previous page)$/i;
type Element = Awaited<ReturnType<Actions['describeControl']>>;

function safeReadClick(grant: Grant, element: Element): boolean {
  if (
    element.download ||
    [element.label, ...element.signals, element.link ?? '', element.formAction ?? ''].some(looksLikeBrowserMutation)
  )
    return false;
  if (element.link !== null) return urlAccess(element.link, restricted(grant)) !== null;
  if (
    element.submit &&
    (element.formMethod !== 'get' ||
      element.formAction === null ||
      urlAccess(element.formAction, restricted(grant)) === null)
  )
    return false;
  return element.disclosure || (element.control && LOW_RISK_BUTTON.test(element.label));
}

function pageAddress(raw: string): string {
  if (!URL.canParse(raw)) return '';
  const url = new URL(raw);
  return url.origin + url.pathname;
}

function blockedRequests(tab: Tab): string[] {
  const lines = tab.blockedDuringAction().map(({ method, url }) => `${method} ${pageAddress(url)}`);
  return [...new Set(lines)].slice(0, 25);
}

export function createBrowserControl(actions: Actions, log: Logger, activity: BrowserActivity) {
  const grants = new Map<string, Grant>();

  async function revoke(conversationId: string): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const grant of grants.values()) {
      if (grant.conversationId !== conversationId || grant.state === 'revoked') continue;
      grant.state = 'revoked';
      grant.tab.changeOwnership();
      delete grant.pending;
      activity.updated(conversationId);
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

  function check(grant: Grant, epoch = grant.tab.ownershipVersion()): void {
    if (epoch !== grant.tab.ownershipVersion()) stale('The preview ownership changed');
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

  async function describe(grant: Grant, input: AssistantBrowserAction, epoch: number) {
    const { action } = input;
    check(grant, epoch);
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
    check(grant, epoch);
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

  async function run(grant: Grant, pending: Pending, confirmed = false) {
    const { tab } = grant;
    const { action } = pending.input;
    const verify = async () => {
      const now = await describe(grant, pending.input, pending.epoch);
      if (pending.url !== now.url || pending.version !== now.version || pending.state !== now.state) {
        stale('The page, target or form changed after the operation was prepared');
      }
    };

    let started = false;
    const work = (async () => {
      await verify();
      tab.begin();
      started = true;
      // 核对页面和目标后，仅在这次动作执行期间放行已确认的写请求。
      const beforeInput = async () => {
        await verify();
        if (confirmed)
          await tab.setPolicy(
            restricted(grant, pending.input.write === undefined ? [] : [pending.input.write], 'confirmed'),
          );
        check(grant, pending.epoch);
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
        if (confirmed) await tab.setPolicy(restricted(grant));
      }
    })();
    grant.busy = true;
    grant.work = work;
    const record = (outcome: AssistantBrowserActivityOutcome, requests: string[]) =>
      activity.record(grant.conversationId, {
        kind: action.kind,
        outcome,
        page: pageAddress(pending.url),
        target: pending.target,
        blockedRequests: requests,
      });
    try {
      const output = await work;
      const requests = blockedRequests(tab);
      record(
        requests.length > 0 || output.blockedWrites.length > 0
          ? AssistantBrowserActivityOutcome.Blocked
          : AssistantBrowserActivityOutcome.Done,
        requests.length > 0 ? requests : output.blockedWrites,
      );
      return output;
    } catch (err) {
      record(AssistantBrowserActivityOutcome.Failed, started ? blockedRequests(tab) : []);
      throw err;
    } finally {
      grant.busy = false;
    }
  }

  return {
    revoke,
    hasPolicy: (tabId: string) => grants.has(tabId),

    info(conversationId: string, tabId: string) {
      const grant = grants.get(tabId);
      const mode =
        grant?.conversationId !== conversationId
          ? AssistantBrowserMode.Off
          : grant.state === 'ready'
            ? AssistantBrowserMode.Assistant
            : grant.state === 'manual'
              ? AssistantBrowserMode.Manual
              : AssistantBrowserMode.Off;
      return { mode, activity: activity.list(conversationId) };
    },

    assertReadable(tabId: string): void {
      const grant = grants.get(tabId);
      if (grant !== undefined && grant.state !== 'ready' && grant.state !== 'revoked')
        throw new AppError(ErrorCode.BrowserNotOpen, 'Return the preview to the assistant before reading');
    },

    async handoff(conversationId: string, tabId: string, manual: boolean): Promise<void> {
      const grant = grants.get(tabId);
      if (grant?.conversationId !== conversationId || grant.state !== (manual ? 'ready' : 'manual')) {
        throw new AppError(ErrorCode.StateTransitionInvalid, 'The preview ownership already changed');
      }
      if (!manual && urlAccess(grant.tab.url(), restricted(grant)) === null)
        throw new AppError(ErrorCode.BrowserNotOpen, 'Return to the project preview before giving back control');
      const transition = manual ? 'taking' : 'returning';
      const inFlight = grant.work;
      grant.state = transition;
      grant.tab.changeOwnership();
      delete grant.pending;
      grant.work = (async () => {
        // 先收窄请求权限，再等正在执行的手势收尾；接管时开放同源手动提交。
        await grant.tab.setPolicy(restricted(grant));
        await Promise.allSettled([inFlight]);
        if (grant.state !== transition) stale('The preview authorization changed');
        if (manual) await grant.tab.setPolicy(restricted(grant, [], 'manual'));
        if (grant.state !== transition) stale('The preview authorization changed');
        grant.tab.changeOwnership();
        grant.state = manual ? 'manual' : 'ready';
        activity.record(conversationId, {
          kind: manual ? AssistantBrowserActivityKind.Take : AssistantBrowserActivityKind.Return,
          outcome: AssistantBrowserActivityOutcome.Done,
          page: pageAddress(grant.tab.url()),
          target: null,
          blockedRequests: [],
        });
      })();
      try {
        await grant.work;
      } catch (err) {
        if (grant.state === transition) await revoke(conversationId);
        throw err;
      }
    },

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
      tab.changeOwnership();
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
        activity.updated(conversationId);
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
      const epoch = grant.tab.ownershipVersion();
      const { url, version, element, state } = await describe(grant, input, epoch);
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
      const target = action.kind === 'press' ? `${action.key} · ${element.label}` : element.label;
      const pending = { requestId: randomUUID(), url, version, state, input, epoch, target };
      const fill =
        (action.kind === 'type' || action.kind === 'select') &&
        !element.download &&
        ![element.label, ...element.signals].some(looksLikeBrowserMutation);
      if (input.write === undefined && (fill || (action.kind === 'click' && safeReadClick(grant, element)))) {
        return { output: await run(grant, pending) } as const;
      }
      grant.pending = pending;
      activity.record(conversationId, {
        kind: action.kind,
        outcome: AssistantBrowserActivityOutcome.Confirmation,
        page: pageAddress(url),
        target,
        blockedRequests: [],
      });
      const fields = element.fields;
      if (action.kind === 'type') fields.push(action.text.slice(0, 200));
      if (action.kind === 'select') fields.push(...action.values.map((value) => value.slice(0, 200)));
      return {
        confirmation: {
          requestId: pending.requestId,
          page: pageAddress(url),
          target,
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
      return run(grant, pending, true);
    },
  };
}
