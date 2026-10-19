import {
  API_PREFIX,
  AppError,
  ErrorCode,
  type ListOperationsResponse,
  listOperationsQuerySchema,
  type OperationContract,
  OperationExposure,
  type OperationInfo,
  OperationRisk,
} from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../http/errors.ts';

/** An operation contract bound to its handler; created by `implement` in each module's `*.operations.ts`. */
export type OperationImpl = {
  contract: OperationContract;
  /** Parses the raw input, runs the handler and parses its result with the output schema. */
  run(rawInput: unknown): Promise<unknown>;
};

/** Handlers only translate: parse → call service → return DTO; business rules live in the service (06 §4). */
export function implement<I extends z.ZodObject, O extends z.ZodType>(
  contract: OperationContract<I, O>,
  handler: (input: z.output<I>) => z.input<O> | Promise<z.input<O>>,
): OperationImpl {
  return {
    contract,
    // The output parse drops anything outside the DTO; a mismatch is a bug and surfaces as INTERNAL_ERROR.
    run: async (rawInput) => contract.output.parse(await handler(parseInput(contract.input, rawInput))),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Path params, query and body merged into one input object; params win so a body cannot redirect the target. */
function mergeInput(params: unknown, query: unknown, body: unknown): Record<string, unknown> {
  if (body !== undefined && body !== null && !isPlainObject(body)) {
    throw new AppError(ErrorCode.ValidationFailed, 'Request body must be a JSON object');
  }
  return { ...(isPlainObject(query) ? query : {}), ...body, ...(isPlainObject(params) ? params : {}) };
}

function successStatus(contract: OperationContract): number {
  if (contract.http.status !== undefined) return contract.http.status;
  return contract.output instanceof z.ZodVoid ? 204 : 200;
}

function toInfo(contract: OperationContract): OperationInfo {
  return {
    id: contract.id,
    title: contract.title,
    description: contract.description,
    risk: contract.risk,
    mode: contract.mode,
    method: contract.http.method,
    path: contract.http.path,
    inputSchema: z.toJSONSchema(contract.input, { io: 'input', unrepresentable: 'any' }),
  };
}

/** Which operations an entry point may offer. Critical operations never go to the palette (14 §2.1). */
export function listOperations(contracts: readonly OperationContract[], expose?: OperationExposure): OperationInfo[] {
  return contracts
    .filter((c) => {
      if (expose === OperationExposure.Palette) return c.expose.palette && c.risk !== OperationRisk.Critical;
      if (expose === OperationExposure.Assistant) return c.expose.assistant;
      return true;
    })
    .map(toInfo);
}

/** Mounts every operation as a REST route under `/api/v1` plus `GET /operations` describing them. */
export function mountOperations(server: FastifyInstance, impls: readonly OperationImpl[]): void {
  const ids = new Set<string>();
  for (const impl of impls) {
    const { contract } = impl;
    if (ids.has(contract.id)) throw new Error(`Duplicate operation id ${contract.id}`);
    ids.add(contract.id);
    const status = successStatus(contract);
    server.route({
      method: contract.http.method,
      url: `${API_PREFIX}${contract.http.path}`,
      handler: async (req, reply) => {
        const result = await impl.run(mergeInput(req.params, req.query, req.body));
        return reply.code(status).send(status === 204 ? undefined : result);
      },
    });
  }

  const contracts = impls.map((i) => i.contract);
  server.get(`${API_PREFIX}/operations`, async (req): Promise<ListOperationsResponse> => {
    const { expose } = parseInput(listOperationsQuerySchema, req.query);
    return { items: listOperations(contracts, expose) };
  });
}
