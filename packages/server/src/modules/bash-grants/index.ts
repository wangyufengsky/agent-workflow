import { createHash } from 'node:crypto';
import type { BashGrant } from '@aw/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../core/db/database.ts';
import { bashGrantsTable as grants } from './bash-grants.table.ts';

export type GrantOwner = 'conversationId' | 'taskId' | 'projectId';

export function bashGrants(db: Db) {
  function address(owner: GrantOwner, id: string, grant: BashGrant) {
    const directory = owner === 'projectId' ? grant.relativeDirectory : grant.directory;
    const key = createHash('sha256')
      .update(JSON.stringify([owner, id, directory, grant.command]))
      .digest('hex');
    return { id: key, directory };
  }
  return {
    permits(owner: GrantOwner, id: string, grant: BashGrant) {
      const row = db
        .select({ fingerprint: grants.fingerprint })
        .from(grants)
        .where(eq(grants.id, address(owner, id, grant).id))
        .get();
      return row?.fingerprint === grant.fingerprint;
    },
    remember(owner: GrantOwner, id: string, grant: BashGrant) {
      db.insert(grants)
        .values({ ...address(owner, id, grant), [owner]: id, command: grant.command, fingerprint: grant.fingerprint })
        .onConflictDoUpdate({ target: grants.id, set: { fingerprint: grant.fingerprint } })
        .run();
    },
    forProject(id: string) {
      return db
        .select({ id: grants.id, directory: grants.directory, command: grants.command })
        .from(grants)
        .where(eq(grants.projectId, id))
        .all();
    },
    revokeProject(id: string, grantId: string) {
      db.delete(grants)
        .where(and(eq(grants.id, grantId), eq(grants.projectId, id)))
        .run();
    },
  };
}
