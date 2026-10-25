import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type BrowserNetwork, ServerEventType, type SettingKey, type SettingsPatch } from '@aw/shared';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { GitNetwork } from '../git/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { createForwardProxy } from './network.forward.ts';
import { chromiumBypassRules } from './network.no-proxy.ts';
import {
  childProxyEnv,
  forwardedProxyEnv,
  isProxied,
  LOOPBACK,
  proxyEnv,
  routeOf,
  routeRequests,
  unrouteRequests,
} from './network.proxy.ts';
import {
  assertCertificates,
  certificatesOf,
  gitCertificatesPem,
  opencodeCertificatesPem,
  trustCertificates,
} from './network.trust.ts';

export type NetworkDeps = {
  settings: SettingsService;
  events: EventBus;
  env: NodeJS.ProcessEnv;
  dataDir: string;
  log: Logger;
};

const TRUST_KEYS: readonly SettingKey[] = ['network.extraCaCerts'];
const PROXY_KEYS: readonly SettingKey[] = ['network.proxy', 'network.noProxy'];

/** Server-side check of a settings change: certificates must parse before they are saved (D164). */
export function validateNetworkSettings(patch: SettingsPatch): void {
  const pem = patch['network.extraCaCerts'];
  if (typeof pem === 'string') assertCertificates(pem);
}

/** Replaces `file` whole, so that a git started meanwhile reads the old bundle or the new one, never half of one. */
async function writeAtomically(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${randomUUID()}`;
  await writeFile(partial, content);
  await rename(partial, file);
}

/**
 * Whom the backend's TLS clients trust (D164) and which proxy its requests take (D165), from the settings and the
 * environment; applied at once and again whenever those settings change. While a proxy is in effect, requests reach
 * it through the forwarding proxy, which alone applies NO_PROXY (D174). opencode and git get the same.
 */
export async function createNetworkModule({ settings, events, env, dataDir, log }: NetworkDeps) {
  const opencodeCertificatesFile = join(dataDir, 'network', 'extra-ca.pem');
  const gitCertificatesFile = join(dataDir, 'network', 'git-ca.pem');
  let gitCertificatesWritten: string | null = null;
  const currentProxy = () =>
    proxyEnv(env, { proxy: settings.get('network.proxy'), noProxy: settings.get('network.noProxy') });
  let route = routeOf(currentProxy());
  const forward = await createForwardProxy({ route: (...request) => route(...request), log });
  const applyProxy = () => {
    const proxy = currentProxy();
    route = routeOf(proxy);
    routeRequests(isProxied(proxy) ? forwardedProxyEnv(proxy, forward) : proxy);
  };

  trustCertificates(settings.get('network.extraCaCerts'));
  applyProxy();
  events.subscribe((event) => {
    if (event.type !== ServerEventType.SettingsUpdated) return;
    const { keys } = event.data;
    if (keys.some((k) => TRUST_KEYS.includes(k))) trustCertificates(settings.get('network.extraCaCerts'));
    if (keys.some((k) => PROXY_KEYS.includes(k))) applyProxy();
  });

  return {
    /**
     * Variables for the next opencode launch: bun reads the system store with `NODE_USE_SYSTEM_CA`, the setting's
     * certificates from the file `NODE_EXTRA_CA_CERTS` names, and the forwarding proxy while a proxy is in effect
     * (changes of the proxy or NO_PROXY then apply without a restart; turning the proxy on or off needs one).
     */
    async opencodeEnv(): Promise<NodeJS.ProcessEnv> {
      const pem = opencodeCertificatesPem(settings.get('network.extraCaCerts'));
      if (pem !== null) await writeAtomically(opencodeCertificatesFile, pem);
      const proxy = currentProxy();
      return {
        NODE_USE_SYSTEM_CA: '1',
        ...(pem === null ? {} : { NODE_EXTRA_CA_CERTS: opencodeCertificatesFile }),
        ...childProxyEnv(isProxied(proxy) ? forwardedProxyEnv(proxy, forward) : proxy),
      };
    },

    /**
     * What git's commands that talk to a remote add (D175), through `GIT_CONFIG_*` so that it wins over the user's git
     * configuration: the bundle of `gitCertificatesPem` as `http.sslCAInfo`, the forwarding proxy as `http.proxy`
     * (the `https` one: git tunnels only https requests, and forwards http ones, which the proxy routes as http),
     * with the credentials sent at once: git would first ask without them, and the proxy ends a refused tunnel.
     */
    async gitEnv(): Promise<GitNetwork> {
      const pem = gitCertificatesPem(settings.get('network.extraCaCerts'));
      if (pem !== null && pem !== gitCertificatesWritten) {
        await writeAtomically(gitCertificatesFile, pem);
        gitCertificatesWritten = pem;
      }
      const proxied = isProxied(currentProxy());
      return {
        config: [
          ...(pem === null ? [] : [['http.sslCAInfo', gitCertificatesFile] as const]),
          ...(proxied
            ? [['http.proxy', forward.url('https')] as const, ['http.proxyAuthMethod', 'basic'] as const]
            : []),
        ],
        env: proxied ? { NO_PROXY: LOOPBACK, no_proxy: LOOPBACK } : {},
      };
    },

    /** The built-in browser follows the settings only (D176): without `network.proxy`, the system's proxy. */
    browserNetwork(): BrowserNetwork {
      const proxy = settings.get('network.proxy');
      return {
        proxy:
          proxy === null ? null : { rules: proxy, bypassRules: chromiumBypassRules(settings.get('network.noProxy')) },
        certificates: certificatesOf(settings.get('network.extraCaCerts')),
      };
    },

    async close(): Promise<void> {
      unrouteRequests();
      await forward.close();
    },
  };
}
export type NetworkModule = Awaited<ReturnType<typeof createNetworkModule>>;
