import { DatabaseSync } from 'node:sqlite';
import {
  CredentialKind,
  changeMasterPasswordOp,
  createDbConnectionOp,
  DbTlsMode,
  DbType,
  ErrorCode,
  getEnvironmentOp,
  MasterPasswordState,
  resetMasterPasswordOp,
  setProjectDbConnectionsOp,
  setupMasterPasswordOp,
  unlockCredentialsOp,
} from '@aw/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, createTask, nodeReaches } from '../../../test/helpers/tasks.ts';

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

  it('重置时还在进行的解锁与修改不会把旧密钥带回来', async () => {
    t = await createTestApp();
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    await restart();
    const { credentials } = t.app.services;

    // Started first: each is still deriving its key (scrypt) when the reset arrives.
    const unlocking = credentials.unlock('correct horse');
    const changing = credentials.changeMasterPassword('correct horse', 'battery staple');
    await credentials.resetMasterPassword();
    await Promise.allSettled([unlocking, changing]);

    expect((await credentials.status()).masterPassword).toBe(MasterPasswordState.None);
    await expect(credentials.create(CredentialKind.GitToken, 'x')).rejects.toMatchObject({
      code: ErrorCode.CredentialUnavailable,
    });
  });

  it('锁定时 AI 的数据库工具返回 CREDENTIAL_LOCKED，并提示请用户解锁', async () => {
    t = await createTestApp();
    await t.call(setupMasterPasswordOp, { password: 'correct horse' });
    // Never reached: the password is needed before connecting.
    const { body: connection } = await t.call(createDbConnectionOp, {
      name: 'shop-db',
      type: DbType.Mysql,
      host: '127.0.0.1',
      port: 3306,
      database: 'shop',
      username: 'app',
      password: 'db-pass',
      tlsMode: DbTlsMode.Off,
    });
    await restart();
    const { project } = await addProject(t);
    await t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds: [connection.id] });
    t.fake.enqueue(script().hang(), { title: '· 定位根因' });
    const running = nodeReaches(t, 'locate', 'running');
    await createTask(t, { projectId: project.id, workflow: 'bugfix' });
    await running;
    const [session] = t.fake.sessions;
    if (session === undefined) throw new Error('No session');
    const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);

    const result = await callTool(mcp, 'db_query', {
      connection: 'shop-db',
      sql: 'SELECT 1',
      __aw_session: session.id,
    });
    await mcp.close();
    expect(result).toMatchObject({
      isError: true,
      body: { code: ErrorCode.CredentialLocked, hint: expect.stringContaining('ask_user') },
    });
  });
});
