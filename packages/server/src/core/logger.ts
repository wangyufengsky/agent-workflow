import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type DestinationStream, type Logger, multistream, pino, destination as pinoDestination } from 'pino';
import type { Clock } from './clock.ts';
import type { AppConfig } from './config.ts';

export type { Logger };

/** `YYYYMMDD` (UTC) used in daily log file names. */
export function dateStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * Structured logger writing to stdout and `<data dir>/logs/app-YYYYMMDD.log` (date of startup).
 * Tests pass their own destination to capture the output.
 */
export function createLogger(config: AppConfig, clock: Clock, destination?: DestinationStream): Logger {
  if (destination !== undefined) return pino({ level: config.logLevel }, destination);
  const logDir = join(config.dataDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const file = pinoDestination({ dest: join(logDir, `app-${dateStamp(clock.now())}.log`), sync: false });
  return pino(
    { level: config.logLevel },
    multistream([
      { level: config.logLevel, stream: process.stdout },
      { level: config.logLevel, stream: file },
    ]),
  );
}
