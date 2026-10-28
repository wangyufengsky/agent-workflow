import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';

/**
 * Git's smart HTTP protocol for the bare repositories under `root` (`git http-backend` as a CGI): over HTTPS with
 * `tls`, a certificate an enterprise CA signed (D175), else plain HTTP; addressed as `host` (default 127.0.0.1).
 * Pushing is allowed: the backend takes the request as an authenticated user's. With `authorization`, a request
 * without exactly that `Authorization` header is answered 401, as a platform does without a token.
 */
export async function createGitHttpServer(options: {
  root: string;
  tls?: { certPem: string; keyPem: string };
  host?: string;
  authorization?: string;
}) {
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    if (options.authorization !== undefined && req.headers.authorization !== options.authorization) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://git');
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: options.root,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: 'aw-test',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
      },
    });
    req.pipe(backend.stdin);
    // CGI output: header lines, a blank line, then the body.
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      backend.stdout.off('data', onData);
      const headers = head.subarray(0, end).toString().split('\r\n');
      const status = headers.find((h) => h.startsWith('Status:'));
      res.writeHead(status === undefined ? 200 : Number(status.split(' ')[1]), {
        ...Object.fromEntries(
          headers
            .filter((h) => !h.startsWith('Status:'))
            .map((h) => [h.slice(0, h.indexOf(':')), h.slice(h.indexOf(':') + 1).trim()]),
        ),
      });
      res.write(head.subarray(end + 4));
      backend.stdout.pipe(res);
    };
    backend.stdout.on('data', onData);
  };
  const server =
    options.tls === undefined
      ? createHttpServer(handle)
      : createHttpsServer({ cert: options.tls.certPem, key: options.tls.keyPem }, handle);
  // Both address families: a test may address it as an IPv4-mapped IPv6 address.
  await new Promise<void>((resolve) => server.listen(0, '::', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    /** The URL of the bare repository `name` under `root`. */
    url: (name: string) =>
      `${options.tls === undefined ? 'http' : 'https'}://${options.host ?? '127.0.0.1'}:${port}/${name}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
