import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName, sql } from 'drizzle-orm';
import { systemClock } from './core/clock.ts';
import { DATABASE_FILE, openReadOnlyDatabase } from './core/db/database.ts';
import {
  applyStartupEnvironment,
  controlProcessOverlay,
  scopedStartupEnvironment,
} from './core/startup-environment.ts';
import type { CredentialCipher } from './modules/credentials/cipher.ts';
import { createCredentialsService } from './modules/credentials/credentials.service.ts';
import { createStartupEnvironmentService } from './modules/startup-environment/startup-environment.service.ts';
import { startupEnvironmentTable } from './modules/startup-environment/startup-environment.table.ts';

export type { CredentialCipher } from './modules/credentials/cipher.ts';

/** Apply current login environment first so explicitly saved startup values win before Node initializes. */
export async function desktopBackendEnvironment(
  dataDir: string,
  inherited: NodeJS.ProcessEnv,
  cipher: CredentialCipher,
): Promise<NodeJS.ProcessEnv> {
  const env = scopedStartupEnvironment(inherited);
  const file = join(dataDir, DATABASE_FILE);
  if (!existsSync(file)) return env;
  const database = openReadOnlyDatabase(file);
  try {
    const table = database.db.get(sql`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = ${getTableName(startupEnvironmentTable)}`);
    if (table === undefined) return env;
    const credentials = createCredentialsService({ db: database.db, clock: systemClock, cipher });
    const startup = createStartupEnvironmentService({ db: database.db, credentials });
    const { env: overlay, deferred } = await startup.resolve();
    applyStartupEnvironment(env, controlProcessOverlay(overlay), deferred);
    return env;
  } finally {
    database.close();
  }
}
