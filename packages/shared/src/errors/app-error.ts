import type { ErrorCode, ErrorInfo } from './codes.ts';

/** The only error type thrown for expected failures; HTTP / MCP layers translate it by `code`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  toInfo(): ErrorInfo {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** Exhaustiveness check for discriminated unions and enum switches. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
