import { z } from 'zod';
import { API_PREFIX } from '../constants/app.ts';
import type { EntityKind, EntityRef, InputRef } from '../enums/entity.ts';
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
  /**
   * Other input fields the assistant may not set: ones that would let it approve its own calls, choose a program the
   * app runs, widen what AI sessions may do or move where they write (D65). Like credentials, they are left out of
   * its tool schema.
   */
  assistantOmit?: ReadonlyArray<keyof z.input<I> & string>;
  /**
   * Input fields that name an object, by what they name: the assistant's confirmation card shows the object's name
   * under its kind instead of the raw id (15 §4).
   */
  refs?: Partial<Record<keyof z.input<I> & string, InputRef>>;
  /** Lowest UI mode that shows the operation. */
  mode: UiMode;
  /**
   * The object the operation creates, and how to read its id and title from the output: the assistant shows it as a
   * navigation card once the operation ran (D66).
   */
  produces?: { kind: EntityKind; ref(output: z.output<O>): { id: string; title: string } };
};

export function defineOperationContract<I extends z.ZodObject, O extends z.ZodType>(
  contract: OperationContract<I, O>,
): OperationContract<I, O> {
  return contract;
}

/** The object an operation produced, read from its (parsed) output; undefined when it produces none. */
export function producedEntity(contract: OperationContract, output: unknown): EntityRef | undefined {
  if (contract.produces === undefined) return undefined;
  return { kind: contract.produces.kind, ...contract.produces.ref(output) };
}

/** Input fields the assistant never sees or sets (15 §5). */
export function assistantHiddenFields(contract: OperationContract): readonly string[] {
  return [...contract.credentialFields, ...(contract.assistantOmit ?? [])];
}

/**
 * The input the assistant may give: the operation's fields without the hidden ones, strict so that a hidden field
 * passed anyway is rejected rather than dropped. Object-level refinements stay with the operation, which parses
 * its own input again when it runs.
 */
export function assistantInputSchema(contract: OperationContract): z.ZodObject {
  const hidden = new Set(assistantHiddenFields(contract));
  return z.strictObject(Object.fromEntries(Object.entries(contract.input.shape).filter(([key]) => !hidden.has(key))));
}

/**
 * Whether the assistant can call the operation as a tool: exposed to it, and no hidden field is required. An
 * operation that needs a credential is reached through `open_form` instead (15 §5).
 */
export function isAssistantCallable(contract: OperationContract): boolean {
  return (
    contract.expose.assistant &&
    assistantHiddenFields(contract).every((key) => {
      const field = contract.input.shape[key];
      // The fields are typed as keys of the input; a missing one is a contract defect.
      if (field === undefined) throw new Error(`${contract.id} hides unknown input field ${key}`);
      return field.safeParse(undefined).success;
    })
  );
}

/** Assistant tool name of an operation: `tasks.start` → `tasks_start` (15 §3). */
export const assistantToolName = (operationId: string) => operationId.replaceAll('.', '_');

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
