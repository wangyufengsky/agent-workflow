import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import type { BrowserNetwork } from '@aw/shared';
import type { Certificate, Request, Session } from 'electron';

/** Chromium's net error for a certificate no trusted root vouches for; any other failure stands. */
const ERR_CERT_AUTHORITY_INVALID = -202;
/** Answers of a certificate verify proc: trusted, or whatever Chromium itself decided. */
const TRUSTED = 0;
const CHROMIUM_DECIDES = -3;
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const ANY_EXTENDED_KEY_USAGE = '2.5.29.37.0';
/** Longer chains than this are not followed (intermediates of a real enterprise CA are one or two). */
const MAX_CHAIN = 8;

const isCurrent = (certificate: X509Certificate, now: Date) =>
  certificate.validFromDate <= now && now <= certificate.validToDate;

/** Whether `issuer`, a CA valid now, signed `subject`. */
const signedBy = (subject: X509Certificate, issuer: X509Certificate, now: Date) =>
  issuer.ca && isCurrent(issuer, now) && subject.checkIssued(issuer) && subject.verify(issuer.publicKey);

/** The certificate and the chain it came with, leaf first. */
function chainOf(certificate: Certificate): X509Certificate[] {
  const chain: X509Certificate[] = [];
  let current: Certificate | undefined = certificate;
  while (current !== undefined && chain.length < MAX_CHAIN) {
    chain.push(new X509Certificate(current.data));
    current = current.issuerCert?.fingerprint === current.fingerprint ? undefined : current.issuerCert;
  }
  return chain;
}

/**
 * Whether a server certificate Chromium could not tie to a trusted root is vouched for by one of the settings'
 * CAs (D176): the leaf is current, names `hostname` and may serve TLS; each link up is signed by a current CA; the
 * chain ends at a settings certificate, or at a certificate it signed. Revocation is not checked.
 */
export function vouchedFor(certificate: Certificate, hostname: string, anchors: X509Certificate[], now: Date): boolean {
  const chain = chainOf(certificate);
  const [leaf] = chain;
  if (leaf === undefined || !isCurrent(leaf, now)) return false;
  const host = hostname.replace(/^\[(.*)\]$/, '$1');
  if ((isIP(host) === 0 ? leaf.checkHost(host) : leaf.checkIP(host)) === undefined) return false;
  const usages = leaf.keyUsage;
  if (usages !== undefined && !usages.includes(SERVER_AUTH) && !usages.includes(ANY_EXTENDED_KEY_USAGE)) return false;
  for (const [i, current] of chain.entries()) {
    if (anchors.some((a) => a.fingerprint256 === current.fingerprint256 || signedBy(current, a, now))) return true;
    const next = chain[i + 1];
    if (next === undefined || !signedBy(current, next, now)) return false;
  }
  return false;
}

/** The verify proc of a partition: Chromium's answer, unless only the issuer was unknown and a settings CA vouches. */
function verifyProc(anchors: X509Certificate[]) {
  return (request: Request, callback: (result: number) => void) => {
    const trusted =
      request.errorCode === ERR_CERT_AUTHORITY_INVALID &&
      vouchedFor(request.certificate, request.hostname, anchors, new Date());
    callback(trusted ? TRUSTED : CHROMIUM_DECIDES);
  };
}

/**
 * The network settings of the tabs' partitions (D176): the settings' proxy, or the system's; trust in the settings'
 * CAs besides the system store. Both hold for a whole partition and are applied again only when they changed.
 */
export function createPartitionNetwork() {
  const applied = new WeakMap<Session, { key: string; anchors: X509Certificate[] }>();
  return {
    async apply(session: Session, network: BrowserNetwork): Promise<void> {
      const key = JSON.stringify(network);
      if (applied.get(session)?.key === key) return;
      const anchors = network.certificates.map((pem) => new X509Certificate(pem));
      applied.set(session, { key, anchors });
      await session.setProxy(
        network.proxy === null
          ? { mode: 'system' }
          : { mode: 'fixed_servers', proxyRules: network.proxy.rules, proxyBypassRules: network.proxy.bypassRules },
      );
      session.setCertificateVerifyProc(anchors.length === 0 ? null : verifyProc(anchors));
      await session.closeAllConnections();
    },

    /**
     * Whether a certificate Chromium refused for its issuer is vouched for by the partition's CAs after all. Chromium
     * keeps a partition's verifications for the whole run, so a site visited before its CA was added would still fail
     * the verify proc: its `certificate-error` asks this. Chromium then remembers the exception for the partition.
     */
    vouches(session: Session, error: string, certificate: Certificate, hostname: string): boolean {
      const anchors = applied.get(session)?.anchors ?? [];
      return error === 'net::ERR_CERT_AUTHORITY_INVALID' && vouchedFor(certificate, hostname, anchors, new Date());
    },
  };
}
