import { z } from 'zod';
import { API_PREFIX } from '../constants/app.ts';
import { type OperationRisk, operationRiskSchema } from '../enums/system.ts';
import { type UiMode, uiModeSchema } from '../enums/ui.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One externally callable operation (03 §5). REST routes, the ⌘K palette and the v1.1 assistant are derived from it.
 * `input` is an object: the HTTP layer merges path params, query and body into it.
 */
export type OperationContract<I extends z.ZodObject = z.ZodObject, O extends z.ZodType = z.ZodType> = {
  /** `domain.action`; the assistant tool name replaces `.` with `_`. */
  id: string;
  /** Copy key of the operation title (web/src/copy). */
  title: string;
  /** English description for the model. */
  description: string;
  input: I;
  output: O;
  /** Decides assistant confirmation; mislabelling is a security defect (06 §4). */
  risk: OperationRisk;
  /** `status` defaults to 200 (204 when the output is `z.void()`). */
  http: { method: HttpMethod; path: string; status?: 200 | 201 | 204 };
  expose: { palette: boolean; assistant: boolean };
  /** Input fields holding secrets: never part of the assistant tool schema (D28). */
  credentialFields: ReadonlyArray<keyof z.input<I> & string>;
  /** Lowest UI mode that shows the operation. */
  mode: UiMode;
};

export function defineOperationContract<I extends z.ZodObject, O extends z.ZodType>(
  contract: OperationContract<I, O>,
): OperationContract<I, O> {
  return contract;
}

/** `GET /operations` item: what the palette (and later the assistant) needs to render and call an operation. */
export const operationInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  risk: operationRiskSchema,
  mode: uiModeSchema,
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type OperationInfo = z.infer<typeof operationInfoSchema>;

export const OperationExposure = {
  Palette: 'palette',
  Assistant: 'assistant',
} as const;
export type OperationExposure = (typeof OperationExposure)[keyof typeof OperationExposure];

export const listOperationsQuerySchema = z.object({ expose: z.enum(OperationExposure).optional() });
export const listOperationsResponseSchema = z.object({ items: z.array(operationInfoSchema) });
export type ListOperationsResponse = z.infer<typeof listOperationsResponseSchema>;

/** An operation call as an HTTP request: `:name` path params filled from the input, the rest as query or JSON body. */
export type OperationRequest = { method: HttpMethod; url: string; body?: Record<string, unknown> };

export function toOperationRequest(contract: OperationContract, input: Record<string, unknown>): OperationRequest {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) rest[key] = value;
  const path = contract.http.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = rest[name];
    delete rest[name];
    return encodeURIComponent(String(value));
  });
  const url = `${API_PREFIX}${path}`;
  const { method } = contract.http;
  if (method === 'GET' || method === 'DELETE') {
    const query = Object.entries(rest)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return { method, url: query === '' ? url : `${url}?${query}` };
  }
  return { method, url, body: rest };
}
