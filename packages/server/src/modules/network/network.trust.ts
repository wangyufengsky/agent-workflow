import { X509Certificate } from 'node:crypto';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { AppError, ErrorCode } from '@aw/shared';

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** The certificates of a PEM bundle, one PEM string each. */
const certificatesOf = (pem: string | null): string[] => pem?.match(PEM_BLOCK) ?? [];

/** VALIDATION_FAILED unless every certificate of the setting `network.extraCaCerts` parses (D164). */
export function assertCertificates(pem: string): void {
  for (const [index, certificate] of certificatesOf(pem).entries()) {
    try {
      new X509Certificate(certificate);
    } catch (e) {
      throw new AppError(ErrorCode.ValidationFailed, 'A CA certificate does not parse', {
        key: 'network.extraCaCerts',
        index,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/**
 * Makes Node's TLS clients (fetch, the database drivers) trust its built-in roots, `NODE_EXTRA_CA_CERTS` as loaded at
 * startup, the operating system's store (as the built-in browser does) and `extra` (D164). Every call starts again
 * from those, so clearing the setting takes its certificates away.
 */
export function trustCertificates(extra: string | null): void {
  setDefaultCACertificates([
    ...getCACertificates('bundled'),
    ...getCACertificates('extra'),
    ...getCACertificates('system'),
    ...certificatesOf(extra),
  ]);
}

/**
 * The bundle `NODE_EXTRA_CA_CERTS` of opencode points to when the setting has certificates: what the backend got from
 * its own `NODE_EXTRA_CA_CERTS`, which the bundle replaces, followed by the setting's. Null without the setting:
 * opencode then keeps the variable as it is.
 */
export function opencodeCertificatesPem(extra: string | null): string | null {
  const own = certificatesOf(extra);
  if (own.length === 0) return null;
  return `${[...getCACertificates('extra'), ...own].map((c) => c.trim()).join('\n')}\n`;
}
