import {
  BrowserBlockReason,
  type CheckResult,
  PageCheckError,
  PageCheckWarning,
  type ViewportPreset,
} from '@aw/shared';
import type { ConsoleEntry, ExceptionEntry, RequestEntry } from './browser.tab.ts';

export type PageCheckResult = Extract<CheckResult, { kind: 'browser' }>;
export type PageCheckPage = PageCheckResult['pages'][number];

/** What one page showed in a page check (29 §7.2), gathered by the browser and judged by `pageCheckVerdict`. */
export type PageFacts = {
  /** Why the main document did not load (`Page.navigate`'s error), or null. */
  navigationError: string | null;
  console: readonly ConsoleEntry[];
  exceptions: readonly ExceptionEntry[];
  requests: readonly RequestEntry[];
  overflow: boolean;
  /** axe-core violations of critical or serious impact. */
  a11y: ReadonlyArray<{ id: string; help: string; nodes: number }>;
  settled: boolean;
};

/** A script, stylesheet, image or font that fails breaks the page (29 §7.3). */
const STATIC = new Set(['Script', 'Stylesheet', 'Image', 'Font']);
const API = new Set(['Fetch', 'XHR']);
const failed = (r: RequestEntry) => r.error !== null || (r.status ?? 0) >= 400;
const what = (r: RequestEntry) =>
  `${r.method} ${r.url}${r.status === null ? '' : ` → ${r.status}`}${r.error === null ? '' : ` (${r.error})`}`;

/**
 * The rules of 29 §7.3: what fails a page (the main document, uncaught exceptions, console errors, broken static
 * files, API 5xx and network errors) and what is only pointed out (API 4xx, requests the rules blocked, serious
 * accessibility problems, horizontal overflow, a page that did not settle).
 */
export function pageCheckVerdict(facts: PageFacts): Pick<PageCheckPage, 'httpStatus' | 'errors' | 'warnings'> {
  const errors: PageCheckPage['errors'] = [];
  const warnings: PageCheckPage['warnings'] = [];
  const main = facts.requests.find((r) => r.resourceType === 'Document');
  const httpStatus = main?.status ?? null;
  if (facts.navigationError !== null) {
    errors.push({ kind: PageCheckError.Navigation, message: facts.navigationError, source: null });
  } else if (httpStatus !== null && httpStatus >= 400) {
    errors.push({ kind: PageCheckError.Navigation, message: `The page answered HTTP ${httpStatus}`, source: null });
  }
  for (const e of facts.exceptions)
    errors.push({ kind: PageCheckError.Exception, message: e.message, source: e.source });
  for (const c of facts.console) {
    if (c.level === 'error') errors.push({ kind: PageCheckError.Console, message: c.text, source: c.source });
  }
  for (const r of facts.requests) {
    if (r === main) continue;
    if (r.blocked !== null) {
      const why = r.blocked === BrowserBlockReason.ReadOnly ? 'a write to a read-only website' : 'not allowed';
      warnings.push({ kind: PageCheckWarning.Blocked, message: `${r.method} ${r.url} was blocked (${why})` });
    } else if (STATIC.has(r.resourceType) && failed(r)) {
      errors.push({ kind: PageCheckError.Request, message: what(r), source: null });
    } else if (API.has(r.resourceType) && (r.error !== null || (r.status ?? 0) >= 500)) {
      errors.push({ kind: PageCheckError.Request, message: what(r), source: null });
    } else if (API.has(r.resourceType) && (r.status ?? 0) >= 400) {
      warnings.push({ kind: PageCheckWarning.Request, message: what(r) });
    }
  }
  for (const v of facts.a11y) {
    warnings.push({ kind: PageCheckWarning.A11y, message: `${v.id}: ${v.help} (${v.nodes})` });
  }
  if (facts.overflow) warnings.push({ kind: PageCheckWarning.Overflow, message: 'The page scrolls sideways' });
  if (!facts.settled) warnings.push({ kind: PageCheckWarning.Unsettled, message: 'The page did not settle in time' });
  return { httpStatus, errors, warnings };
}

/** The page check as the AI reads it in its feedback (29 §7.4): every page, its errors first. */
export function pageCheckOutput(pages: ReadonlyArray<PageCheckPage & { viewport: ViewportPreset }>): string {
  return pages
    .map((p) => {
      const head = `${p.errors.length === 0 ? 'PASS' : 'FAIL'} ${p.path} (${p.viewport})`;
      const lines = [
        ...p.errors.map((e) => `  error [${e.kind}] ${e.message}${e.source === null ? '' : ` at ${e.source}`}`),
        ...p.warnings.map((w) => `  warning [${w.kind}] ${w.message}`),
      ];
      return [head, ...lines].join('\n');
    })
    .join('\n');
}
