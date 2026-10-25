import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Files of a test certificate authority and of one server certificate it signed, as PEM. */
export type TestCertificates = {
  dir: string;
  /** The authority's certificate: what a client is told to trust. */
  caPem: string;
  certPem: string;
  keyPem: string;
};

/**
 * A certificate authority of its own (an enterprise CA no client trusts by default) and a server certificate it signed
 * for `hosts` (DNS names or IPv4 addresses), made with the openssl command line. The files are `ca.pem`, `server.pem`
 * and `server-key.pem` in `dir`; the directory and the key are readable by everyone, as a database server in a
 * container runs as its own user. On Linux a bind mount keeps the host's owner and mode, and `mkdtemp` makes the
 * directory 0700: MySQL then cannot read its certificates, logs a warning and starts without TLS. Docker Desktop on
 * macOS shows a mount as owned by the container's user, which hid this.
 */
export async function createTestCertificates(hosts: string[]): Promise<TestCertificates> {
  const dir = await mkdtemp(join(tmpdir(), 'aw-tls-'));
  const file = (name: string) => join(dir, name);
  const openssl = (...args: string[]) => run('openssl', args, { cwd: dir });
  await openssl(
    ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=AW Test CA'],
    ...['-keyout', 'ca-key.pem', '-out', 'ca.pem'],
  );
  await openssl(
    ...['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${hosts[0]}`],
    ...['-keyout', 'server-key.pem', '-out', 'server.csr'],
  );
  const names = hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? `IP:${h}` : `DNS:${h}`));
  await writeFile(file('server.ext'), `subjectAltName=${names.join(',')}\n`);
  await openssl(
    ...['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial'],
    ...['-days', '2', '-extfile', 'server.ext', '-out', 'server.pem'],
  );
  await chmod(dir, 0o755);
  await chmod(file('server-key.pem'), 0o644);
  const [caPem, certPem, keyPem] = await Promise.all([
    readFile(file('ca.pem'), 'utf8'),
    readFile(file('server.pem'), 'utf8'),
    readFile(file('server-key.pem'), 'utf8'),
  ]);
  return { dir, caPem, certPem, keyPem };
}
