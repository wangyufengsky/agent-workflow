import { DatabaseSync } from 'node:sqlite';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { CredentialKind, type CredentialPortResponse, credentialPortRequestSchema, ErrorCode } from '@aw/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { type CipherTransport, createPortCipher } from './cipher.ts';

/** Stands in for Electron main: answers requests on the other end of a real MessagePort. */
function fakeMain(port: MessagePort, options: { available: boolean }) {
  // Reversible but not identity, like safeStorage: the stored bytes must not contain the plaintext.
  const seal = (s: string) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)).toString('base64');
  const open = (b64: string) => Buffer.from([...Buffer.from(b64, 'base64')].map((b) => b ^ 0x5a)).toString('utf8');
  port.on('message', (message) => {
    const { id, op, data } = credentialPortRequestSchema.parse(message);
    const response: CredentialPortResponse = options.available
      ? { type: 'credential.response', id, ok: true, data: op === 'encrypt' ? seal(data) : open(data) }
      : { type: 'credential.response', id, ok: false, error: 'safeStorage encryption is not available' };
    port.postMessage(response);
  });
}

function portTransport(port: MessagePort): CipherTransport {
  return { send: (m) => port.postMessage(m), onMessage: (listener) => port.on('message', listener) };
}

let t: TestApp;
const channels: MessageChannel[] = [];
async function appWithMain(available: boolean) {
  const channel = new MessageChannel();
  channels.push(channel);
  fakeMain(channel.port2, { available });
  t = await createTestApp({ cipher: createPortCipher(portTransport(channel.port1)) });
  return t.app.services.credentials;
}
afterEach(async () => {
  await t.close();
  for (const c of channels.splice(0)) c.port1.close();
});

describe('凭据加解密', () => {
  it('经 MessagePort 加密存库、解密往返，库中不含明文', async () => {
    const credentials = await appWithMain(true);
    const id = await credentials.create(CredentialKind.GitToken, 'ghp_secret-123');

    expect(await credentials.reveal(id)).toBe('ghp_secret-123');
    const raw = new DatabaseSync(`${t.dataDir}/app.db`, { readOnly: true });
    const row = raw.prepare('select ciphertext from credentials where id = ?').get(id);
    raw.close();
    expect(Buffer.from(row?.ciphertext as Uint8Array).toString('utf8')).not.toContain('ghp_secret');
  });

  it('替换后解密得到新值', async () => {
    const credentials = await appWithMain(true);
    const id = await credentials.create(CredentialKind.DbPassword, 'old');
    await credentials.replace(id, 'new');
    expect(await credentials.reveal(id)).toBe('new');
  });

  it('main 无法加密时抛 CREDENTIAL_UNAVAILABLE', async () => {
    const credentials = await appWithMain(false);
    await expect(credentials.create(CredentialKind.GitToken, 'x')).rejects.toMatchObject({
      code: ErrorCode.CredentialUnavailable,
    });
  });

  it('没有加密后端时使用凭据抛 CREDENTIAL_UNAVAILABLE', async () => {
    t = await createTestApp();
    await expect(t.app.services.credentials.create(CredentialKind.GitToken, 'x')).rejects.toMatchObject({
      code: ErrorCode.CredentialUnavailable,
    });
  });
});
