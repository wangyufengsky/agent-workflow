import { X509Certificate } from 'node:crypto';
import type { Certificate } from 'electron';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestCertificates, type TestCertificates } from '../../../../packages/server/test/helpers/tls.ts';
import { vouchedFor } from './browser-network.ts';

/** A server certificate as Chromium hands it to the verify proc: the leaf, sent without its CA. */
const served = (pem: string) => ({ data: pem, fingerprint: new X509Certificate(pem).fingerprint256 }) as Certificate;

let site: TestCertificates;
let other: TestCertificates;
let clientOnly: TestCertificates;
beforeAll(async () => {
  site = await createTestCertificates(['wiki.corp.test', '10.1.2.3']);
  other = await createTestCertificates(['wiki.corp.test']);
  clientOnly = await createTestCertificates(['wiki.corp.test'], { extendedKeyUsage: 'clientAuth' });
});
const anchors = () => [new X509Certificate(site.caPem)];

// Each test reads the clock itself: the certificates are valid only from when `beforeAll` made them.
describe('设置里的 CA 为证书担保的条件（D176）', () => {
  it('设置里的 CA 签发、名称或 IP 一致的证书可信', () => {
    const now = new Date();
    expect(vouchedFor(served(site.certPem), 'wiki.corp.test', anchors(), now)).toBe(true);
    expect(vouchedFor(served(site.certPem), '10.1.2.3', anchors(), now)).toBe(true);
  });

  it('名称不一致、别的 CA 签发、过期、不能用于服务器的证书都不可信', () => {
    const now = new Date();
    expect(vouchedFor(served(site.certPem), 'evil.corp.test', anchors(), now)).toBe(false);
    expect(vouchedFor(served(other.certPem), 'wiki.corp.test', anchors(), now)).toBe(false);
    const later = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    expect(vouchedFor(served(site.certPem), 'wiki.corp.test', anchors(), later)).toBe(false);
    const clientAnchors = [new X509Certificate(clientOnly.caPem)];
    expect(vouchedFor(served(clientOnly.certPem), 'wiki.corp.test', clientAnchors, now)).toBe(false);
  });
});
