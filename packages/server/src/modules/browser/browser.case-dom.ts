import { AppError, type BrowserCaseAssertion, ErrorCode } from '@aw/shared';
import { z } from 'zod';
import type { Tab } from './browser.tab.ts';

const ASSERTION_WAIT_MS = 4_000;

export async function resolveCaseRef(tab: Tab, selector: string): Promise<string> {
  const { root } = z.object({ root: z.object({ nodeId: z.number() }) }).parse(await tab.cdp('DOM.getDocument'));
  const { nodeIds } = z
    .object({ nodeIds: z.array(z.number()) })
    .parse(await tab.cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector }));
  const [nodeId] = nodeIds;
  if (nodeId === undefined || nodeIds.length !== 1)
    throw new AppError(ErrorCode.BrowserActionFailed, 'The selector must match exactly one element');
  const { node } = z
    .object({ node: z.object({ backendNodeId: z.number() }) })
    .parse(await tab.cdp('DOM.describeNode', { nodeId }));
  return tab.registerCaseRef(node.backendNodeId);
}

const assertionResult = z.object({
  pass: z.boolean(),
  actual: z.union([z.boolean(), z.string()]).nullable(),
  sensitive: z.boolean(),
});

export async function evaluateCaseAssertion(tab: Tab, expect: BrowserCaseAssertion) {
  const result = assertionResult.parse(
    await tab.evaluate(`new Promise((resolve) => {
    const expected = ${JSON.stringify(expect)};
    const read = () => {
      if (expected.kind === 'path') return { pass: location.pathname === expected.value, actual: location.pathname, sensitive: false };
      const nodes = document.querySelectorAll(expected.selector);
      if (nodes.length !== 1) return { pass: false, actual: expected.kind === 'visible' ? false : null, sensitive: false };
      const element = nodes[0];
      if (expected.kind === 'visible') {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const actual = box.width > 0 && box.height > 0 && style.visibility === 'visible' && style.opacity !== '0';
        return { pass: actual, actual, sensitive: false };
      }
      if (expected.kind === 'value' && element.matches(
        'input[type=password], input[type=file], [autocomplete*=password], [autocomplete=one-time-code], [autocomplete=webauthn]'
      )) return { pass: false, actual: null, sensitive: true };
      const actual = expected.kind === 'value' ? element.value : (element.innerText ?? element.textContent ?? '');
      return { pass: typeof actual === 'string' && (expected.kind === 'value' ? actual === expected.value : actual.includes(expected.value)),
        actual: typeof actual === 'string' ? actual.slice(0, 4000) : null, sensitive: false };
    };
    const first = read();
    if (first.pass || first.sensitive) return resolve(first);
    const finish = (result) => { clearInterval(tick); clearTimeout(end); resolve(result); };
    const tick = setInterval(() => { const result = read(); if (result.pass || result.sensitive) finish(result); }, 100);
    const end = setTimeout(() => finish(read()), ${ASSERTION_WAIT_MS});
  })`),
  );
  if (result.sensitive)
    throw new AppError(ErrorCode.BrowserLoginRequired, 'Browser tests cannot read credentials or file inputs');
  return result;
}
