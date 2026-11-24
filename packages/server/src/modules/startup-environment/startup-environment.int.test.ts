import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ErrorCode,
  getStartupEnvironmentOp,
  setStartupEnvironmentOp,
  setupMasterPasswordOp,
  unlockCredentialsOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { DATABASE_FILE } from '../../core/db/database.ts';

const secretValue = 'fixture-secret-93';
const publicValue = '  value = literal \n';
const publicItem = { name: 'MY_PROJECT_FLAG', secret: false, value: publicValue } as const;
const secretItem = { name: 'SERVICE_TOKEN', secret: true, value: secretValue } as const;

function credentialCount(dataDir: string) {
  const db = new DatabaseSync(join(dataDir, DATABASE_FILE), { readOnly: true });
  try {
    return db.prepare("SELECT COUNT(*) AS count FROM credentials WHERE kind='startup_environment'").get()?.count;
  } finally {
    db.close();
  }
}

it('stores literal values and encrypted secrets, returns metadata only, and preserves an omitted existing secret', async () => {
  const app = await createTestApp({ cipher: testCipher });
  try {
    const saved = await app.call(setStartupEnvironmentOp, { items: [publicItem, secretItem] });
    expect(saved.status).toBe(200);
    const visible = { revision: saved.body.revision, items: [publicItem, { name: secretItem.name, secret: true }] };
    expect(saved.body).toEqual(visible);
    expect((await app.call(getStartupEnvironmentOp, {})).body).toEqual(visible);
    expect(credentialCount(app.dataDir)).toBe(1);

    const db = new DatabaseSync(join(app.dataDir, DATABASE_FILE), { readOnly: true });
    try {
      expect(db.prepare('SELECT value FROM startup_environment WHERE name = ?').get(secretItem.name)?.value).toBeNull();
      expect(db.prepare('SELECT hex(ciphertext) AS bytes FROM credentials').get()?.bytes).not.toContain(
        Buffer.from(secretValue).toString('hex').toUpperCase(),
      );
    } finally {
      db.close();
    }
    expect(await app.app.services.startupEnvironment.resolve()).toMatchObject({
      env: { [publicItem.name]: publicValue, [secretItem.name]: secretValue },
      deferred: [],
    });

    const retained = await app.call(setStartupEnvironmentOp, {
      items: [
        { name: 'service_token', secret: true },
        { name: '__proto__', secret: false, value: '' },
        { name: 'AW_PROJECT_CUSTOM', secret: false, value: 'allowed' },
        { name: 'LD_LIBRARY_PATH', secret: false, value: '/opt/project/lib' },
        { name: 'NODE_PATH', secret: false, value: '/opt/project/node_modules' },
        { name: 'NODE_ENV', secret: false, value: 'test' },
      ],
    });
    expect(retained.body.items[0]).toEqual({ name: 'service_token', secret: true });
    const ready = await app.app.services.startupEnvironment.resolve();
    expect(Object.hasOwn(ready.env, '__proto__')).toBe(true);
    expect(Object.entries(ready.env)).toContainEqual(['__proto__', '']);
    expect(ready.env.service_token).toBe(secretValue);
    expect(ready.env).toMatchObject({
      LD_LIBRARY_PATH: '/opt/project/lib',
      NODE_PATH: '/opt/project/node_modules',
      NODE_ENV: 'test',
    });

    await app.call(setStartupEnvironmentOp, { items: [] });
    expect(credentialCount(app.dataDir)).toBe(0);
  } finally {
    await app.close();
  }
});

it('keeps all previous rows and hides plaintext when one encryption in a replacement fails', async () => {
  const failValue = 'must-never-appear-in-errors';
  const app = await createTestApp({
    cipher: {
      ...testCipher,
      async encrypt(plain) {
        if (plain === failValue) throw new Error(plain);
        return testCipher.encrypt(plain);
      },
    },
  });
  try {
    await app.call(setStartupEnvironmentOp, { items: [publicItem, secretItem] });
    const failed = await app.call(setStartupEnvironmentOp, {
      items: [
        { name: 'NEW_FIRST', secret: true, value: 'valid' },
        { name: 'NEW_FAIL', secret: true, value: failValue },
      ],
    });
    expect(failed.body).toMatchObject({ error: { code: ErrorCode.CredentialUnavailable } });
    expect(JSON.stringify([failed.body, app.logs])).not.toContain(failValue);
    expect(credentialCount(app.dataDir)).toBe(1);
    expect((await app.call(getStartupEnvironmentOp, {})).body.items).toEqual([
      publicItem,
      { name: secretItem.name, secret: true },
    ]);
    expect((await app.app.services.startupEnvironment.resolve()).env[secretItem.name]).toBe(secretValue);
  } finally {
    await app.close();
  }
});

it('retries only deferred secrets captured before unlock and leaves later settings for a new startup', async () => {
  const password = 'fixture-master-password';
  let app = await createTestApp();
  try {
    expect((await app.call(setupMasterPasswordOp, { password })).status).toBe(200);
    expect((await app.call(setStartupEnvironmentOp, { items: [publicItem, secretItem] })).status).toBe(200);
    const dataDir = app.dataDir;
    await app.close();
    app = await createTestApp({ dataDir });

    const snapshot = await app.app.services.startupEnvironment.resolve();
    expect(snapshot).toMatchObject({ env: { [publicItem.name]: publicValue }, deferred: [secretItem.name] });
    expect(snapshot.env[secretItem.name]).toBeUndefined();
    expect(
      (
        await app.call(setStartupEnvironmentOp, {
          items: [
            { ...publicItem, value: 'next startup' },
            { name: secretItem.name, secret: true },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await app.call(unlockCredentialsOp, { password })).status).toBe(200);
    expect(await snapshot.retryDeferred()).toEqual({ env: { [secretItem.name]: secretValue }, deferred: [] });
    expect(snapshot.env).toEqual({ [publicItem.name]: publicValue });
    expect((await app.app.services.startupEnvironment.resolve()).env).toMatchObject({
      [publicItem.name]: 'next startup',
      [secretItem.name]: secretValue,
    });
  } finally {
    await app.close();
  }
});

it('rejects invalid names, duplicate keys, missing new secrets and NUL values without leaking input', async () => {
  const app = await createTestApp({ cipher: testCipher });
  try {
    const invalid = [
      { items: [{ ...publicItem, name: '1INVALID' }] },
      { items: [{ ...publicItem, name: 'aw_api_TOKEN' }] },
      { items: [publicItem, { ...secretItem, name: 'my_project_flag' }] },
      { items: [{ name: secretItem.name, secret: true as const }] },
      { items: [{ ...secretItem, value: 'private-feature-value\0' }] },
    ];
    for (const input of invalid) {
      const result = await app.call(setStartupEnvironmentOp, input);
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).not.toContain('private-feature-value');
    }
    expect((await app.call(getStartupEnvironmentOp, {})).body.items).toEqual([]);
    expect(getStartupEnvironmentOp.expose).toEqual({ palette: false, assistant: false });
    expect(setStartupEnvironmentOp.expose).toEqual({ palette: false, assistant: false });
  } finally {
    await app.close();
  }
});

it('rejects stale whole-list updates after another write rotates a secret', async () => {
  const app = await createTestApp({ cipher: testCipher });
  try {
    const first = await app.call(setStartupEnvironmentOp, { items: [publicItem, secretItem] });
    const expectedRevision = first.body.revision;
    const [winner, stale] = await Promise.all([
      app.call(setStartupEnvironmentOp, { expectedRevision, items: [publicItem, { ...secretItem, value: 'rotated' }] }),
      app.call(setStartupEnvironmentOp, {
        expectedRevision,
        items: [publicItem, { ...secretItem, value: 'rotated in other window' }],
      }),
    ]);
    const responses = [winner, stale];
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const current = (await app.call(getStartupEnvironmentOp, {})).body;
    expect(current.revision).not.toBe(expectedRevision);
    expect(current.items).toEqual(first.body.items);
    expect(credentialCount(app.dataDir)).toBe(1);
    expect(current).toEqual(responses.find(({ status }) => status === 200)?.body);
  } finally {
    await app.close();
  }
});

it('does not inject a replacement secret into an existing startup snapshot after decryption becomes available', async () => {
  let locked = false;
  const app = await createTestApp({
    cipher: {
      ...testCipher,
      async decrypt(bytes) {
        if (locked) throw new Error('Test storage locked');
        return testCipher.decrypt(bytes);
      },
    },
  });
  try {
    await app.call(setStartupEnvironmentOp, { items: [secretItem] });
    locked = true;
    const snapshot = await app.app.services.startupEnvironment.resolve();
    expect(snapshot.deferred).toEqual([secretItem.name]);
    await app.call(setStartupEnvironmentOp, { items: [{ ...secretItem, value: 'newly-saved-secret' }] });
    locked = false;
    expect(await snapshot.retryDeferred()).toEqual({ env: {}, deferred: [secretItem.name] });
    expect((await app.app.services.startupEnvironment.resolve()).env[secretItem.name]).toBe('newly-saved-secret');
  } finally {
    await app.close();
  }
});

it.each(['reset', 'rotate'] as const)(
  'handles a master password %s during preparation of a multi-row replacement',
  async (change) => {
    let prepareProbe = 0;
    let pause = false;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const app = await createTestApp({
      cipher: {
        ...testCipher,
        async isAvailable() {
          if (!pause || ++prepareProbe !== 2) return false;
          entered.resolve();
          await release.promise;
          return true;
        },
      },
    });
    try {
      const password = 'fixture-original-password';
      await app.app.services.credentials.setupMasterPassword(password);
      const original = await app.call(setStartupEnvironmentOp, { items: [publicItem] });
      pause = true;
      const pending = app.call(setStartupEnvironmentOp, {
        expectedRevision: original.body.revision,
        items: [
          { name: 'VAULT_SECRET', secret: true, value: secretValue },
          { name: 'SYSTEM_SECRET', secret: true, value: 'fixture-system-secret' },
        ],
      });
      try {
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw new Error('Expected staged encryption');
          }),
        ]);
        if (change === 'reset') await app.app.services.credentials.resetMasterPassword();
        else await app.app.services.credentials.changeMasterPassword(password, 'fixture-updated-password');
      } finally {
        release.resolve();
      }
      const result = await pending;
      if (change === 'reset') {
        expect(result.body).toMatchObject({ error: { code: ErrorCode.CredentialUnavailable } });
        expect((await app.call(getStartupEnvironmentOp, {})).body).toEqual(original.body);
        expect(credentialCount(app.dataDir)).toBe(0);
      } else {
        expect(result.status).toBe(200);
        expect((await app.app.services.startupEnvironment.resolve()).env).toEqual({
          VAULT_SECRET: secretValue,
          SYSTEM_SECRET: 'fixture-system-secret',
        });
      }
    } finally {
      await app.close();
    }
  },
);
