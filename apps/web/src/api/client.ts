import {
  type ErrorCode,
  type ErrorInfo,
  errorResponseSchema,
  type OperationContract,
  toOperationRequest,
} from '@aw/shared';
import type { z } from 'zod';

/** Renderer token: from the Electron preload, or `VITE_AW_API_TOKEN` when running in a plain browser (dev / E2E). */
export function apiToken(): string {
  if (window.aw !== undefined) return window.aw.apiToken;
  const token = import.meta.env.VITE_AW_API_TOKEN;
  if (token === undefined) throw new Error('No API token: not running in Electron and VITE_AW_API_TOKEN is unset');
  return token;
}

/** A failed operation; the UI picks the message by `code` (copy/errors.ts). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorInfo['details'];

  constructor(status: number, info: ErrorInfo) {
    super(info.message);
    this.name = 'ApiError';
    this.code = info.code;
    this.status = status;
    this.details = info.details;
  }
}

/** Calls an operation over REST; request shape and response type both come from the shared contract. */
export async function callOperation<I extends z.ZodObject, O extends z.ZodType>(
  op: OperationContract<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  const { method, url, body } = toOperationRequest(op, input);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new ApiError(res.status, errorResponseSchema.parse(await res.json()).error);
  return op.output.parse(res.status === 204 ? undefined : await res.json());
}

/** A file of a non-operation endpoint (a screenshot), with the same auth and error handling. */
export async function getBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken()}` } });
  if (!res.ok) throw new ApiError(res.status, errorResponseSchema.parse(await res.json()).error);
  return res.blob();
}

/** GET of a non-operation endpoint (e.g. `/operations`), with the same auth and error handling. */
export async function getJson<S extends z.ZodType>(url: string, schema: S): Promise<z.output<S>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken()}` } });
  if (!res.ok) throw new ApiError(res.status, errorResponseSchema.parse(await res.json()).error);
  return schema.parse(await res.json());
}
