import { createDbConnectionOp, DbTlsMode, DbType, testDbConnectionOp, updateSettingsOp } from '@aw/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { startMysql, type TestDatabase } from '../../../test/helpers/db-containers.ts';
import { createTestCertificates, type TestCertificates } from '../../../test/helpers/tls.ts';

const TLS_USER = 'tls_only';
const TLS_PASSWORD = 'aw-test-tls';

let certificates: TestCertificates;
let mysql: TestDatabase;
let t: TestApp;

beforeAll(async () => {
  // An enterprise CA that signed the server's certificate for the address the connection uses.
  certificates = await createTestCertificates(['127.0.0.1', 'localhost']);
  mysql = await startMysql(certificates);
  // A plain connection cannot log in as this user: a successful login proves the connection is encrypted.
  await mysql.exec(`CREATE USER '${TLS_USER}'@'%' IDENTIFIED BY '${TLS_PASSWORD}' REQUIRE SSL;
    GRANT SELECT ON shop.* TO '${TLS_USER}'@'%';`);
}, 180_000);
afterAll(() => mysql.stop());

beforeEach(async () => {
  t = await createTestApp({ cipher: testCipher });
});
afterEach(() => t.close());

/** Adds a connection as the TLS-only user; returns a function that tests it. */
async function addConnection(name: string, tlsMode: DbTlsMode) {
  const { body } = await t.call(createDbConnectionOp, {
    name,
    type: DbType.Mysql,
    host: mysql.host,
    port: mysql.port,
    database: mysql.database,
    username: TLS_USER,
    password: TLS_PASSWORD,
    tlsMode,
  });
  expect(body.tlsMode).toBe(tlsMode);
  return async () => (await t.call(testDbConnectionOp, { id: body.id })).body;
}

describe('数据库 TLS 三档与企业 CA（D164、D166）', () => {
  it('不加密连不上要求 TLS 的账号；加密不校验不需要 CA；校验证书只信任系统与设置里的 CA', async () => {
    expect(await (await addConnection('plain', DbTlsMode.Off))()).toMatchObject({ ok: false });
    expect(await (await addConnection('no-verify', DbTlsMode.NoVerify))()).toMatchObject({ ok: true });
    const verify = await addConnection('verify', DbTlsMode.Verify);
    expect(await verify()).toMatchObject({ ok: false, error: expect.stringMatching(/certificate/i) });

    await t.call(updateSettingsOp, { 'network.extraCaCerts': certificates.caPem });
    expect(await verify()).toMatchObject({ ok: true });
    await t.call(updateSettingsOp, { 'network.extraCaCerts': null });
    expect(await verify()).toMatchObject({ ok: false });
  });
});
