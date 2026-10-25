import { randomUUID } from 'node:crypto';
import {
  AppError,
  CredentialKind,
  ErrorCode,
  type HostingAccountDTO,
  HostingProvider,
  type SetHostingAccountRequest,
} from '@aw/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { CredentialsService } from '../credentials/index.ts';
import { type HostingEndpoints, hostingAccountOf } from './hosting.provider.ts';
import { hostingAccountsTable } from './hosting.table.ts';

/**
 * A platform address as stored and matched against origin (D155): null for github.com and gitlab.com, a self-hosted
 * GitLab's without a trailing slash.
 */
export function normalizeBaseUrl(provider: HostingProvider, baseUrl: string | null | undefined): string | null {
  if (provider === HostingProvider.Github || baseUrl === null || baseUrl === undefined) return null;
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === 'https://gitlab.com' ? null : trimmed;
}

export type HostingAccountsServiceDeps = {
  db: Db;
  clock: Clock;
  credentials: CredentialsService;
  endpoints: HostingEndpoints;
};

type Row = typeof hostingAccountsTable.$inferSelect;

const toDto = ({ credentialId: _, ...account }: Row): HostingAccountDTO => account;

/** Global GitHub / GitLab tokens, one per platform address (D155); the token itself stays in credentials. */
export function createHostingAccountsService({ db, clock, credentials, endpoints }: HostingAccountsServiceDeps) {
  const t = hostingAccountsTable;
  const find = (provider: HostingProvider, baseUrl: string | null): Row | undefined =>
    db
      .select()
      .from(t)
      .where(and(eq(t.provider, provider), baseUrl === null ? isNull(t.baseUrl) : eq(t.baseUrl, baseUrl)))
      .get();

  return {
    list(): HostingAccountDTO[] {
      return db.select().from(t).orderBy(asc(t.provider), asc(t.baseUrl)).all().map(toDto);
    },

    /** Saves the token once the platform accepts it, replacing the address's earlier one. */
    async set({ provider, baseUrl: rawBaseUrl, token }: SetHostingAccountRequest): Promise<HostingAccountDTO> {
      const baseUrl = normalizeBaseUrl(provider, rawBaseUrl);
      const account = await hostingAccountOf(provider, baseUrl, token, endpoints);
      const credentialId = await credentials.create(CredentialKind.GitToken, token);
      // Nothing below awaits: two saves of one address cannot both see it empty and insert twice.
      const now = clock.now();
      const existing = find(provider, baseUrl);
      if (existing !== undefined) {
        db.update(t).set({ account, credentialId, updatedAt: now }).where(eq(t.id, existing.id)).run();
        credentials.remove(existing.credentialId);
      } else {
        db.insert(t)
          .values({ id: randomUUID(), provider, baseUrl, account, credentialId, createdAt: now, updatedAt: now })
          .run();
      }
      const saved = find(provider, baseUrl);
      if (saved === undefined) throw new Error('hosting account vanished after saving');
      return toDto(saved);
    },

    remove(id: string): void {
      const row = db.select().from(t).where(eq(t.id, id)).get();
      if (row === undefined) throw new AppError(ErrorCode.NotFound, `Hosting account ${id} not found`, { id });
      db.delete(t).where(eq(t.id, id)).run();
      credentials.remove(row.credentialId);
    },

    /** Whether the platform address has a global token. */
    has: (provider: HostingProvider, baseUrl: string | null): boolean => find(provider, baseUrl) !== undefined,

    /** The address's global token, decrypted for immediate use; undefined when there is none. */
    async token(provider: HostingProvider, baseUrl: string | null): Promise<string | undefined> {
      const row = find(provider, baseUrl);
      return row === undefined ? undefined : credentials.reveal(row.credentialId);
    },
  };
}
export type HostingAccountsService = ReturnType<typeof createHostingAccountsService>;
