import type { BrowserTestScope } from '@aw/shared';
import { BROWSER_TEST_COPY as C } from '../../copy/tasks.ts';

export function parseBrowserWriteLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [method, path, ...rest] = line.split(/\s+/);
      return { method: method?.toUpperCase(), path: rest.length === 0 ? path : undefined };
    });
}

export const browserWriteLines = (scope: BrowserTestScope) =>
  scope.writes.map(({ method, path }) => `${method} ${path}`).join('\n');

export function BrowserCaseScope({ scope }: { scope: BrowserTestScope }) {
  return (
    <dl className="col">
      <dt>{C.target}</dt>
      <dd className="mono">{scope.target}</dd>
      <dt>{C.writes}</dt>
      <dd className="mono">{browserWriteLines(scope) || C.noWrites}</dd>
    </dl>
  );
}
