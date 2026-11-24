import { createHash } from 'node:crypto';
import { AppError, CredentialKind, ErrorCode, type StartupEnvironment, type StartupEnvironmentInput } from '@aw/shared';
import { asc } from 'drizzle-orm';
import type { Db, DbExecutor } from '../../core/db/database.ts';
import { startupEnvironmentTable as table } from './startup-environment.table.ts';

type Secret = { name: string; credentialId: string };
type Resolved = { env: Record<string, string>; deferred: string[] };

type StartupCredentialAccess = {
  prepare(kind: CredentialKind, value: string): Promise<{ id: string; save(executor: DbExecutor): void }>;
  reveal(id: string): Promise<string>;
  remove(id: string, executor?: DbExecutor): void;
};

export function createStartupEnvironmentService({ db, credentials }: { db: Db; credentials: StartupCredentialAccess }) {
  const read = (executor: DbExecutor = db) => executor.select().from(table).orderBy(asc(table.position)).all();
  const revision = (rows: ReturnType<typeof read>) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const get = (): StartupEnvironment => {
    const rows = read();
    return {
      revision: revision(rows),
      items: rows.map(({ name, value }) => (value === null ? { name, secret: true } : { name, secret: false, value })),
    };
  };
  function assertRevision(rows: ReturnType<typeof read>, expected: string | undefined) {
    if (expected !== undefined && expected !== revision(rows))
      throw new AppError(ErrorCode.StateTransitionInvalid, 'Startup environment changed since it was loaded');
  }
  let writes = Promise.resolve();
  async function replace({ items, expectedRevision }: StartupEnvironmentInput) {
    const previous = read();
    assertRevision(previous, expectedRevision);
    const previousByKey = new Map(previous.map((row) => [row.key, row]));
    for (const [index, item] of items.entries()) {
      if (item.secret && item.value === undefined && previousByKey.get(item.name.toUpperCase())?.credentialId == null)
        throw new AppError(ErrorCode.ValidationFailed, 'Provide a value for a new secret', {
          issues: [{ path: ['items', index, 'value'], message: 'A new secret requires a value' }],
        });
    }
    const stores: Awaited<ReturnType<StartupCredentialAccess['prepare']>>[] = [];
    const next: (typeof previous)[number][] = [];
    for (const [position, item] of items.entries()) {
      const key = item.name.toUpperCase();
      let credentialId: string | null = null;
      if (item.secret) {
        if (item.value === undefined) {
          credentialId = previousByKey.get(key)?.credentialId ?? null;
        } else {
          try {
            const prepared = await credentials.prepare(CredentialKind.StartupEnvironment, item.value);
            stores.push(prepared);
            credentialId = prepared.id;
          } catch (error) {
            const code =
              error instanceof AppError && error.code === ErrorCode.CredentialLocked
                ? ErrorCode.CredentialLocked
                : ErrorCode.CredentialUnavailable;
            throw new AppError(code, 'The startup environment secret could not be encrypted');
          }
        }
      }
      next.push({ key, name: item.name, credentialId, value: item.secret ? null : item.value, position });
    }
    const retained = new Set(next.map(({ credentialId }) => credentialId));
    db.transaction((tx) => {
      assertRevision(read(tx), expectedRevision);
      for (const prepared of stores) prepared.save(tx);
      tx.delete(table).run();
      if (next.length > 0) tx.insert(table).values(next).run();
      for (const { credentialId } of previous) {
        if (credentialId !== null && !retained.has(credentialId)) credentials.remove(credentialId, tx);
      }
    });
    return get();
  }
  function set(input: StartupEnvironmentInput) {
    const result = writes.then(() => replace(input));
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function reveal(secrets: readonly Secret[]) {
    const entries: [string, string][] = [];
    const deferred: Secret[] = [];
    for (const secret of secrets) {
      try {
        entries.push([secret.name, await credentials.reveal(secret.credentialId)]);
      } catch {
        deferred.push(secret);
      }
    }
    return { entries, deferred };
  }
  async function resolve(): Promise<Resolved & { retryDeferred(): Promise<Resolved> }> {
    const literals: [string, string][] = [];
    const secrets: Secret[] = [];
    for (const { name, value, credentialId } of read()) {
      if (value !== null) literals.push([name, value]);
      else if (credentialId !== null) secrets.push({ name, credentialId });
    }
    const initial = await reveal(secrets);
    let pending = initial.deferred;
    return {
      env: Object.fromEntries([...literals, ...initial.entries]),
      deferred: pending.map(({ name }) => name),
      async retryDeferred() {
        const retry = await reveal(pending);
        pending = retry.deferred;
        return { env: Object.fromEntries(retry.entries), deferred: pending.map(({ name }) => name) };
      },
    };
  }

  return { get, set, resolve };
}

export type StartupEnvironmentService = ReturnType<typeof createStartupEnvironmentService>;
