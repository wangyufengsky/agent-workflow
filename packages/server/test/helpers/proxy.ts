import { createServer, request } from 'node:http';
import { connect, type Socket } from 'node:net';

/**
 * An HTTP proxy that tunnels HTTPS (`CONNECT host:port`) and forwards plain http requests (absolute form), recording
 * each target. Every host name leads to this machine: a test addresses a local fake by a name that does not resolve,
 * so only a request through the proxy reaches it.
 */
export async function createTestProxy() {
  const connects: string[] = [];
  const forwards: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '');
    forwards.push(url.host);
    const out = request(
      {
        host: '127.0.0.1',
        port: url.port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: req.headers,
        agent: false,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    req.pipe(out);
  });
  server.on('connect', (req, client: Socket) => {
    const target = req.url ?? '';
    connects.push(target);
    const upstream = connect(Number(target.split(':').at(-1)), '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on('close', () => sockets.delete(socket));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The test proxy is not listening on TCP');
  return {
    url: `http://127.0.0.1:${address.port}`,
    /** `host:port` of each tunnel asked for, in order. */
    connects,
    /** `host:port` of each plain http request forwarded, in order. */
    forwards,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
export type TestProxy = Awaited<ReturnType<typeof createTestProxy>>;
