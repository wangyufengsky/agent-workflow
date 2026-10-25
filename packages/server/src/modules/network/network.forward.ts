import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Socket } from 'node:net';
import type { Logger } from '../../core/logger.ts';

/** The scheme of the request a client tunnels or forwards: it decides which upstream proxy applies (D165). */
export type ProxyScheme = 'http' | 'https';

/** Where a request for `host:port` goes: through this upstream proxy, or direct (null). */
export type Route = (scheme: ProxyScheme, host: string, port: number) => URL | null;

const LISTEN_HOST = '127.0.0.1';

/** A URL's host name as sockets take it: an IPv6 address without its brackets. */
const bare = (hostname: string) => hostname.replace(/^\[(.*)\]$/, '$1');

/** `Basic …` of a proxy URL's credentials, as an upstream proxy expects them. */
function basicAuth(url: URL): Record<string, string> {
  if (url.username === '') return {};
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return { 'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}` };
}

/** `host:port` of a CONNECT request, an IPv6 address in brackets. */
function targetOf(authority: string): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(authority);
  if (match?.[1] === undefined) return null;
  return { host: bare(match[1]), port: Number(match[2]) };
}

function end(socket: Socket, status: string, extra = ''): void {
  socket.end(`HTTP/1.1 ${status}\r\n${extra}\r\n`);
}

/**
 * The backend's forwarding proxy (D174) on a loopback port: whenever a proxy is in effect, the backend's own requests,
 * opencode's and git's come here, and `route` sends each direct or through the upstream proxy. Only those holding the
 * per-run secret may use it; the user name names the scheme (`https` for tunnels of https requests), since a tunnel
 * alone does not tell which upstream applies. Plain http requests in absolute form are forwarded too.
 */
export async function createForwardProxy({ route, log }: { route: Route; log: Logger }) {
  const secret = randomBytes(32).toString('hex');
  const expected = (scheme: ProxyScheme) =>
    Buffer.from(`Basic ${Buffer.from(`${scheme}:${secret}`).toString('base64')}`);
  const schemeOf = (req: IncomingMessage): ProxyScheme | null => {
    const given = Buffer.from(req.headers['proxy-authorization'] ?? '');
    for (const scheme of ['http', 'https'] as const) {
      const want = expected(scheme);
      if (given.length === want.length && timingSafeEqual(given, want)) return scheme;
    }
    return null;
  };
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };

  /** Joins the client to `upstream` once it is open; a failure on either side ends both. */
  function join(client: Socket, upstream: Socket, clientHead: Buffer, upstreamHead: Buffer): void {
    track(upstream);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (upstreamHead.length > 0) client.write(upstreamHead);
    if (clientHead.length > 0) upstream.write(clientHead);
    upstream.pipe(client);
    client.pipe(upstream);
    for (const socket of [client, upstream]) {
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
    }
  }

  function tunnel(req: IncomingMessage, client: Socket, head: Buffer): void {
    client.on('error', () => client.destroy());
    const scheme = schemeOf(req);
    if (scheme === null) {
      end(client, '407 Proxy Authentication Required', 'Proxy-Authenticate: Basic\r\n');
      return;
    }
    const target = targetOf(req.url ?? '');
    if (target === null) {
      end(client, '400 Bad Request');
      return;
    }
    const upstream = route(scheme, target.host, target.port);
    if (upstream === null) {
      const failed = (e: Error) => {
        log.warn({ target: req.url, err: e }, 'direct tunnel failed');
        end(client, '502 Bad Gateway');
      };
      const direct = connect(target.port, target.host, () => {
        direct.off('error', failed);
        join(client, direct, head, Buffer.alloc(0));
      });
      direct.once('error', failed);
      return;
    }
    const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const ask = send({
      host: bare(upstream.hostname),
      port: upstream.port,
      method: 'CONNECT',
      path: req.url,
      headers: { host: req.url, ...basicAuth(upstream) },
      // As below: the global agents lead back here.
      agent: false,
    });
    ask.on('connect', (res, socket, upstreamHead) => {
      if (res.statusCode === 200) return join(client, socket, head, upstreamHead);
      log.warn({ target: req.url, status: res.statusCode }, 'upstream proxy refused a tunnel');
      socket.destroy();
      end(client, '502 Bad Gateway');
    });
    ask.on('error', (e) => {
      log.warn({ target: req.url, err: e }, 'upstream proxy unreachable');
      end(client, '502 Bad Gateway');
    });
    ask.end();
  }

  function forward(req: IncomingMessage, res: ServerResponse): void {
    if (schemeOf(req) === null) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic' });
      res.end();
      return;
    }
    const url = URL.parse(req.url ?? '');
    if (url === null || url.protocol !== 'http:') {
      res.writeHead(400);
      res.end();
      return;
    }
    const host = bare(url.hostname);
    const upstream = route('http', host, Number(url.port || 80));
    const { 'proxy-authorization': _secret, 'proxy-connection': _connection, ...headers } = req.headers;
    const send = upstream?.protocol === 'https:' ? httpsRequest : httpRequest;
    // Never the global agents: they lead back here (`routeRequests`).
    const out = send(
      upstream === null
        ? {
            host,
            port: url.port || 80,
            method: req.method,
            path: `${url.pathname}${url.search}`,
            headers,
            agent: false,
          }
        : {
            host: bare(upstream.hostname),
            port: upstream.port,
            method: req.method,
            path: url.href,
            headers: { ...headers, ...basicAuth(upstream) },
            agent: false,
          },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    out.on('error', (e) => {
      log.warn({ target: url.host, err: e }, 'forwarding a request failed');
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(out);
  }

  const server = createServer(forward);
  server.on('connect', tunnel);
  server.on('connection', track);
  await new Promise<void>((resolve) => server.listen(0, LISTEN_HOST, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The forwarding proxy is not listening on TCP');
  const { port } = address;

  return {
    /** The proxy URL a client gives for requests of `scheme`. */
    url: (scheme: ProxyScheme) => `http://${scheme}:${secret}@${LISTEN_HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
export type ForwardProxy = Awaited<ReturnType<typeof createForwardProxy>>;
