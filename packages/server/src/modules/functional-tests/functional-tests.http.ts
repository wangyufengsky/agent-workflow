import { AppError, blockReason, ErrorCode, type FunctionalTestStep } from '@aw/shared';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_BYTES_MAX = 1_048_576;
const SECRET = /password|passwd|secret|cookie|authorization|api.?key|access.?key|credential|token|^pwd$/i;
const jsonSchema = z.json();
type Json = z.output<typeof jsonSchema>;

export function redact(value: Json): Json {
  if (typeof value === 'string')
    return value
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
      .replace(
        /((?:password|passwd|token|authorization|cookie|secret|api.?key)[\w-]*["']?\s*[:=]\s*["']?)[^\s,;&"']+/gi,
        '$1[redacted]',
      )
      .slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 80).map(redact);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 80)
        .map(([key, entry]) => [key, SECRET.test(key) ? '[redacted]' : redact(entry)]),
    );
  return value;
}
export function redactText(text: string): string {
  return String(redact(text));
}

type Result = { status: number; body: Json | undefined };
export function fieldValue(input: unknown, field: string): Json | undefined {
  let value = input;
  for (const key of field.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = Reflect.get(value, key);
  }
  const parsed = jsonSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function interpolate(text: string, results: Map<number, Result>, encode: (value: string) => string): string {
  return text.replace(/\{\{(\d+)\.(status|body(?:\.[\w-]+)*)\}\}/g, (_match, step: string, field: string) => {
    const value = fieldValue(results.get(Number(step)), field);
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      throw new AppError(ErrorCode.ValidationFailed, 'An earlier response reference has no scalar value', {
        step,
        field,
      });
    return encode(String(value));
  });
}

function bodyOf(value: Json, results: Map<number, Result>): Json {
  if (typeof value === 'string') {
    const exact = /^\{\{(\d+)\.(status|body(?:\.[\w-]+)*)\}\}$/.exec(value);
    const step = exact?.[1];
    const field = exact?.[2];
    if (step !== undefined && field !== undefined) {
      const selected = fieldValue(results.get(Number(step)), field);
      if (selected !== undefined) return selected;
    }
    return interpolate(value, results, (text) => text);
  }
  if (Array.isArray(value)) return value.map((item) => bodyOf(item, results));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, bodyOf(entry, results)]));
  return value;
}

async function readJson(response: Response): Promise<Json | undefined> {
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_BYTES_MAX) return undefined;
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return jsonSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return undefined;
    throw error;
  }
}

type WriteScope = Parameters<typeof blockReason>[1]['automation'];
export async function scopedRequest(url: URL, init: RequestInit & { method: string }, scope: NonNullable<WriteScope>) {
  const signal =
    init.signal === undefined || init.signal === null
      ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      : AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      url.username ||
      url.password ||
      blockReason(
        { url: url.href, method: init.method, isWebSocket: false },
        { sites: [], previewOrigins: [scope.origin], automation: scope },
        true,
      ) !== null
    ) {
      throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'The request is outside the authorized test scope');
    }
    const response = await fetch(url, { ...init, signal, redirect: 'manual' });
    const to = response.headers.get('location');
    if (to === null || ![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    // 写请求的响应可能意味着服务端已提交，任何重定向都不得重复发送写操作。
    if (init.method !== 'GET' && init.method !== 'HEAD')
      throw new AppError(
        ErrorCode.StateTransitionInvalid,
        'A redirect followed this request; verify its result before retrying',
      );
    url = new URL(to, url);
  }
  throw new AppError(ErrorCode.ValidationFailed, 'Too many redirects in the test target');
}

export function createHttpRunner(origin: string, scope: NonNullable<WriteScope>, signal: AbortSignal) {
  const responses = new Map<number, Result>();
  return async (
    step: Extract<FunctionalTestStep, { kind: 'http' }>,
    index: number,
    onRequest: (path: string) => void,
  ) => {
    const url = new URL(interpolate(step.path, responses, encodeURIComponent), origin);
    onRequest(url.pathname);
    const body = step.body === undefined ? undefined : bodyOf(step.body, responses);
    const response = await scopedRequest(
      url,
      {
        method: step.method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
        signal,
      },
      scope,
    );
    const result = { status: response.status, body: await readJson(response) };
    responses.set(index, result);
    return result;
  };
}
