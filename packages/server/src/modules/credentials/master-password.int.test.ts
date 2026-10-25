import { DatabaseSync } from 'node:sqlite';
import {
  CredentialKind,
  changeMasterPasswordOp,
  ErrorCode,
  getEnvironmentOp,
  MasterPasswordState,
  resetMasterPasswordOp,
  setupMasterPasswordOp,
  unlockCredentialsOp,
} from '@aw/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';

// No cipher: the backend runs like the desktop app on a Linux without a secret service (D74, D167).
let t: TestApp;
afterEach(() => t.close());

async function restart(): Promise<TestApp> {
  const { dataDir } = t;
  await t.close();
  t = await createTestApp({ dataDir });
  return t;
}

function storedCiphertext(id: string): string {
  const raw = new DatabaseSync(`${t.dataDir}/app.db`, { readOnly: true });
  const row = raw.prepare('select ciphertext from credentials where id = ?').get(id);
  raw.close();
  return Buffer.from(row?.ciphertext as Uint8Array).toString('latin1');
}

describe('主密码（D167）', () => {
  it('没有系统密钥服务时设置主密码后可以保存凭据，库中不含明文', async () => {
    t = await createTestApp();
    const before = await t.call(getEnvironmentOp, {});
    expect(before.body.credentials).toEqual({
      available: false,
      system: false,
      masterPassword: MasterPasswordState.None,
    });

    const setup = await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    expect(setup.status).toBe(200);
    expect(setup.body).toEqual({ available: true, system: false, masterPassword: MasterPasswordState.Unlocked });

    const id = await t.app.services.credentials.create(CredentialKind.GitToken, 'glpat-secret-123');
    expect(await t.app.services.credentials.reveal(id)).toBe('glpat-secret-123');
    expect(storedCiphertext(id)).not.toContain('glpat-secret');
  });

  it('重启后先锁定，主密码不对时拒绝，解锁后能读出', async () => {
    t = await createTestApp();
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    const id = await t.app.services.credentials.create(CredentialKind.DbPassword, 'db-pass');

    await restart();
    expect((await t.call(getEnvironmentOp, {})).body.credentials).toEqual({
      available: false,
      system: false,
      masterPassword: MasterPasswordState.Locked,
    });
    await expect(t.app.services.credentials.reveal(id)).rejects.toMatchObject({ code: ErrorCode.CredentialLocked });
    await expect(t.app.services.credentials.create(CredentialKind.GitToken, 'x')).rejects.toMatchObject({
      code: ErrorCode.CredentialLocked,
    });

    const wrong = await t.call(unlockCredentialsOp, { password: 'wrong horse' });
    expect(wrong.body).toMatchObject({ error: { code: ErrorCode.MasterPasswordIncorrect } });
    const unlocked = await t.call(unlockCredentialsOp, { password: 'correct horse' });
    expect(unlocked.body.masterPassword).toBe(MasterPasswordState.Unlocked);
    expect(await t.app.services.credentials.reveal(id)).toBe('db-pass');
  });

  it('修改主密码后只有新密码能解锁，已存的凭据不变', async () => {
    t = await createTestApp();
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    const id = await t.app.services.credentials.create(CredentialKind.GitToken, 'token-1');

    const wrong = await t.call(changeMasterPasswordOp, { currentPassword: 'nope nope', newPassword: 'battery staple' });
    expect(wrong.body).toMatchObject({ error: { code: ErrorCode.MasterPasswordIncorrect } });
    expect(
      (await t.call(changeMasterPasswordOp, { currentPassword: 'correct horse', newPassword: 'battery staple' }))
        .status,
    ).toBe(200);

    await restart();
    expect((await t.call(unlockCredentialsOp, { password: 'correct horse' })).body).toMatchObject({
      error: { code: ErrorCode.MasterPasswordIncorrect },
    });
    await t.call(unlockCredentialsOp, { password: 'battery staple' });
    expect(await t.app.services.credentials.reveal(id)).toBe('token-1');
  });

  it('重置后旧凭据要重新填写，填写后用新主密码保存', async () => {
    t = await createTestApp();
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    const id = await t.app.services.credentials.create(CredentialKind.GitToken, 'token-1');
    await restart();

    const reset = await t.call(resetMasterPasswordOp, {});
    expect(reset.body).toEqual({ available: false, system: false, masterPassword: MasterPasswordState.None });
    await expect(t.app.services.credentials.reveal(id)).rejects.toMatchObject({ code: ErrorCode.CredentialLost });
    expect(storedCiphertext(id)).toBe('');

    await t.call(setupMasterPasswordOp, { password: 'new password' });
    await t.app.services.credentials.replace(id, 'token-2');
    expect(await t.app.services.credentials.reveal(id)).toBe('token-2');
  });

  it('已设置时不能再设置，没设置时不能解锁', async () => {
    t = await createTestApp();
    expect((await t.call(unlockCredentialsOp, { password: 'correct horse' })).body).toMatchObject({
      error: { code: ErrorCode.MasterPasswordNotSet },
    });
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    expect((await t.call(setupMasterPasswordOp, { password: 'another one' })).body).toMatchObject({
      error: { code: ErrorCode.MasterPasswordExists },
    });
  });

  it('系统密钥服务可用时仍用它保存，即使设置过主密码', async () => {
    t = await createTestApp();
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    const id = await t.app.services.credentials.create(CredentialKind.GitToken, 'vault-token');
    const { dataDir } = t;
    await t.close();
    // The secret service came up later (gnome-keyring installed): new secrets go there, old ones keep their seal.
    t = await createTestApp({ dataDir, cipher: testCipher });
    expect((await t.call(getEnvironmentOp, {})).body.credentials).toEqual({
      available: true,
      system: true,
      masterPassword: MasterPasswordState.Locked,
    });
    const systemId = await t.app.services.credentials.create(CredentialKind.GitToken, 'system-token');
    expect(await t.app.services.credentials.reveal(systemId)).toBe('system-token');
    await expect(t.app.services.credentials.reveal(id)).rejects.toMatchObject({ code: ErrorCode.CredentialLocked });
  });
});
