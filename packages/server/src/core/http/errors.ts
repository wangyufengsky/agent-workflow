import { API_PREFIX, AppError, ERROR_HTTP_STATUS, ErrorCode, type ErrorResponse } from '@aw/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { z } from 'zod';

/** Parses a request boundary value; failures become 400 VALIDATION_FAILED with the zod issues. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(ErrorCode.ValidationFailed, 'Request validation failed', { issues: result.error.issues });
  }
  return result.data;
}

function toResponse(error: AppError): { status: number; body: ErrorResponse } {
  // Codes without an HTTP status are recorded on attempts or returned over MCP; reaching HTTP with one is a bug.
  return { status: ERROR_HTTP_STATUS[error.code] ?? 500, body: { error: error.toInfo() } };
}

function isFastifyClientError(error: unknown): error is FastifyError {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}

/**
 * Single exit for errors: AppError by code, Fastify client errors (bad JSON …) as 400, everything else as 500.
 * With `serveSpa`, unknown non-API GETs return the built renderer's index.html so client-side routes survive reloads.
 */
export function registerErrorHandling(app: FastifyInstance, options: { serveSpa: boolean }): void {
  app.setErrorHandler(async (error, req, reply) => {
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else if (isFastifyClientError(error)) {
      appError = new AppError(ErrorCode.ValidationFailed, error.message, { fastifyCode: error.code });
    } else {
      req.log.error({ err: error }, 'unhandled error');
      appError = new AppError(ErrorCode.InternalError, 'Internal server error');
    }
    const { status, body } = toResponse(appError);
    if (status >= 500 && appError.code !== ErrorCode.InternalError) req.log.error({ err: error }, 'request failed');
    await reply.code(status).send(body);
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith(API_PREFIX)) {
      const { status, body } = toResponse(new AppError(ErrorCode.NotFound, `No route ${req.method} ${req.url}`));
      return reply.code(status).send(body);
    }
    if (options.serveSpa && req.method === 'GET') return reply.sendFile('index.html');
    return reply.code(404).send();
  });
}
