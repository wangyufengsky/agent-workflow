import { expect, it } from 'vitest';
import { createProjectLog } from '../previews/index.ts';

it('redacts split lines, known secret values, credentials in URLs and quoted assignments', () => {
  const log = createProjectLog({ ACCESS_KEY: 'known-token-value' });
  log.append('authorization: Bear');
  expect(log.tail()).toBe('');
  log.append('er hidden-value\nrequest https://user:password@127.0.0.1\n');
  log.append('{"token":"secret with spaces"}\nplain known-token-');
  log.append('value');
  log.flush();
  expect(log.tail()).not.toMatch(/hidden-value|user:password|secret with spaces|known-token-value/);
  expect(log.tail()).toContain('https://[redacted]@127.0.0.1');
  expect(log.tail()).toContain('plain [redacted]');
});

it('omits oversized log lines without releasing their suffix', () => {
  const log = createProjectLog({});
  log.append('prefix '.repeat(3000));
  log.append('private suffix\nnormal line\n');
  expect(log.tail()).toBe('[oversized module output omitted]\nnormal line\n');
});
