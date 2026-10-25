import { setGlobalProxyFromEnv } from 'node:http';
import type { ForwardProxy, Route } from './network.forward.ts';
import { noProxyMatcher } from './network.no-proxy.ts';

/** The backend, opencode and page previews reach each other here; such requests never go through a proxy (D165). */
export const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'].join(',');

/** The proxy in effect, as the variables Node and bun read; a proxy is absent when nothing names one. */
export type ProxyEnv = { HTTP_PROXY?: string; HTTPS_PROXY?: string; NO_PROXY: string };

/** curl's order, which Node and bun follow: the lowercase variable first. */
const variable = (env: NodeJS.ProcessEnv, name: string) => env[name.toLowerCase()] || env[name] || undefined;

/**
 * The proxy settings replace the environment variables as a whole when `network.proxy` is set; otherwise the
 * variables apply (D165). Loopback addresses are always added to NO_PROXY.
 */
export function proxyEnv(env: NodeJS.ProcessEnv, settings: { proxy: string | null; noProxy: string[] }): ProxyEnv {
  if (settings.proxy !== null) {
    return {
      HTTP_PROXY: settings.proxy,
      HTTPS_PROXY: settings.proxy,
      NO_PROXY: [...settings.noProxy, LOOPBACK].join(','),
    };
  }
  const http = variable(env, 'HTTP_PROXY');
  const https = variable(env, 'HTTPS_PROXY');
  const noProxy = variable(env, 'NO_PROXY');
  return {
    ...(http === undefined ? {} : { HTTP_PROXY: http }),
    ...(https === undefined ? {} : { HTTPS_PROXY: https }),
    NO_PROXY: [...(noProxy === undefined ? [] : [noProxy]), LOOPBACK].join(','),
  };
}

export const isProxied = (proxy: ProxyEnv) => proxy.HTTP_PROXY !== undefined || proxy.HTTPS_PROXY !== undefined;

/** A proxy variable may leave out the scheme, as curl allows. */
const proxyUrl = (value: string) => new URL(value.includes('://') ? value : `http://${value}`);

/** Where the forwarding proxy sends each request by `proxy` (D174): direct when NO_PROXY matches or no proxy applies. */
export function routeOf(proxy: ProxyEnv): Route {
  const direct = noProxyMatcher([proxy.NO_PROXY]);
  const upstream = {
    http: proxy.HTTP_PROXY === undefined ? null : proxyUrl(proxy.HTTP_PROXY),
    https: proxy.HTTPS_PROXY === undefined ? null : proxyUrl(proxy.HTTPS_PROXY),
  };
  return (scheme, host, port) => (direct(host, port) ? null : upstream[scheme]);
}

/**
 * What the backend's own requests, opencode and git are told (D174): the forwarding proxy for each scheme a proxy is in
 * effect for, so that the one matcher of `routeOf` decides; loopback addresses never reach it.
 */
export function forwardedProxyEnv(proxy: ProxyEnv, forward: ForwardProxy): ProxyEnv {
  return {
    ...(proxy.HTTP_PROXY === undefined ? {} : { HTTP_PROXY: forward.url('http') }),
    ...(proxy.HTTPS_PROXY === undefined ? {} : { HTTPS_PROXY: forward.url('https') }),
    NO_PROXY: LOOPBACK,
  };
}

/**
 * Puts back what the previous `routeRequests` replaced. The global agents are the process's, so this is too: a backend
 * started again in the same process (tests) replaces the previous one's routing.
 */
let restorePrevious = () => {};

/**
 * Routes the backend's fetch and http(s) requests by `proxy`, replacing the previous routing: without a proxy Node's
 * own agents come back, and with one fresh agents start (their connections are made under the current settings).
 */
export function routeRequests(proxy: ProxyEnv): void {
  restorePrevious();
  restorePrevious = setGlobalProxyFromEnv({ ...proxy });
}

/** Node's own agents again, once the backend that routed requests closes. */
export function unrouteRequests(): void {
  restorePrevious();
  restorePrevious = () => {};
}

/** `proxy` in both cases for a child process: its own variables may otherwise win in either case. */
export function childProxyEnv(proxy: ProxyEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(proxy).flatMap(([name, value]) => [
      [name, value],
      [name.toLowerCase(), value],
    ]),
  );
}
