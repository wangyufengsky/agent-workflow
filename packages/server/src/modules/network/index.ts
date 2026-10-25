import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ServerEventType, type SettingKey, type SettingsPatch } from '@aw/shared';
import type { EventBus } from '../../core/event-bus.ts';
import type { SettingsService } from '../settings/index.ts';
import { childProxyEnv, proxyEnv, routeRequests } from './network.proxy.ts';
import { assertCertificates, opencodeCertificatesPem, trustCertificates } from './network.trust.ts';

export type NetworkDeps = { settings: SettingsService; events: EventBus; env: NodeJS.ProcessEnv; dataDir: string };

const TRUST_KEYS: readonly SettingKey[] = ['network.extraCaCerts'];
const PROXY_KEYS: readonly SettingKey[] = ['network.proxy', 'network.noProxy'];

/** Server-side check of a settings change: certificates must parse before they are saved (D164). */
export function validateNetworkSettings(patch: SettingsPatch): void {
  const pem = patch['network.extraCaCerts'];
  if (typeof pem === 'string') assertCertificates(pem);
}

/**
 * Whom the backend's TLS clients trust (D164) and which proxy its requests take (D165), from the settings and the
 * environment; applied at once and again whenever those settings change. opencode gets the same at each launch.
 */
export function createNetworkModule({ settings, events, env, dataDir }: NetworkDeps) {
  const opencodeCertificatesFile = join(dataDir, 'network', 'extra-ca.pem');
  const currentProxy = () =>
    proxyEnv(env, { proxy: settings.get('network.proxy'), noProxy: settings.get('network.noProxy') });

  trustCertificates(settings.get('network.extraCaCerts'));
  routeRequests(currentProxy());
  events.subscribe((event) => {
    if (event.type !== ServerEventType.SettingsUpdated) return;
    const { keys } = event.data;
    if (keys.some((k) => TRUST_KEYS.includes(k))) trustCertificates(settings.get('network.extraCaCerts'));
    if (keys.some((k) => PROXY_KEYS.includes(k))) routeRequests(currentProxy());
  });

  return {
    /**
     * Variables for the next opencode launch: bun reads the system store with `NODE_USE_SYSTEM_CA`, the setting's
     * certificates from the file `NODE_EXTRA_CA_CERTS` names, and the proxy in effect.
     */
    async opencodeEnv(): Promise<NodeJS.ProcessEnv> {
      const pem = opencodeCertificatesPem(settings.get('network.extraCaCerts'));
      if (pem !== null) {
        await mkdir(dirname(opencodeCertificatesFile), { recursive: true });
        await writeFile(opencodeCertificatesFile, pem);
      }
      return {
        NODE_USE_SYSTEM_CA: '1',
        ...(pem === null ? {} : { NODE_EXTRA_CA_CERTS: opencodeCertificatesFile }),
        ...childProxyEnv(currentProxy()),
      };
    },
  };
}
export type NetworkModule = ReturnType<typeof createNetworkModule>;
