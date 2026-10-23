/**
 * The browser of tests that go through other modules (the MCP tools): a real Chromium (29 §5.2). Not exported from
 * the browser module's index, which the production bundle includes.
 */
export { createChromiumHost } from '../../src/modules/browser/host.chromium.ts';
