import { RuntimeStatus, type Settings } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Panel } from '../../components/panel.tsx';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import { runtimeQuery, useRestartRuntime } from '../runtime/runtime.queries.ts';
import { TextSetting } from './setting-inputs.tsx';

/** PEM text, saved on blur or when read from a file; empty means none (null). */
function CertificatesSetting({ value, onCommit }: { value: string | null; onCommit: (pem: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  const commit = (next: string) => {
    const pem = next.trim() === '' ? null : `${next.trim()}\n`;
    if (pem !== value) onCommit(pem);
  };
  return (
    <>
      <textarea
        id="setting-ca"
        className="textarea mono"
        rows={6}
        placeholder="-----BEGIN CERTIFICATE-----"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
      />
      <div className="row">
        <label className="btn ghost sm">
          <Icon name="file" size="sm" />
          {C.extraCaFile}
          <input
            className="sr"
            type="file"
            accept=".pem,.crt,.cer"
            onChange={(e) => {
              const [file] = e.target.files ?? [];
              void file?.text().then((pem) => {
                setText(pem);
                commit(pem);
              });
            }}
          />
        </label>
      </div>
    </>
  );
}

/**
 * The network panel: the offline environment (D168) for everyone, and in pro mode whom the backend trusts and which
 * proxy it takes (D164, D165; inputs are keyed by the saved value). The offline setting applies when opencode starts,
 * so while the running one was started the other way the panel offers to restart it now.
 */
export function NetworkSettings({
  settings,
  set,
  isPro,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  isPro: boolean;
}) {
  const runtime = useQuery(runtimeQuery).data;
  const restart = useRestartRuntime();
  const offline = settings['network.offline'];
  const stale = runtime?.status === RuntimeStatus.Ready && runtime.offline !== offline;
  const noProxy = settings['network.noProxy'].join(',');
  return (
    <Panel title={C.network}>
      <div className="row">
        <div className="grow col">
          <span className="label" id="offline-label">
            {C.offline}
          </span>
          <span className="hint">{C.offlineHint}</span>
        </div>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={offline}
          aria-labelledby="offline-label"
          onClick={() => set({ 'network.offline': !offline })}
        />
      </div>
      {stale && (
        <div className="row">
          <p className="hint grow">{C.offlineRestartHint}</p>
          <Button icon="refresh" pending={restart.isPending} onClick={() => restart.mutate()}>
            {C.restartNow}
          </Button>
        </div>
      )}
      {restart.isError && <ErrorState error={restart.error} />}
      {isPro && (
        <>
          <div className="field">
            <label className="label" htmlFor="setting-ca">
              {C.extraCa}
            </label>
            <CertificatesSetting
              key={settings['network.extraCaCerts'] ?? ''}
              value={settings['network.extraCaCerts']}
              onCommit={(pem) => set({ 'network.extraCaCerts': pem })}
            />
            <p className="hint">{C.extraCaHint}</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="setting-proxy">
              {C.proxy}
            </label>
            <TextSetting
              key={settings['network.proxy'] ?? ''}
              id="setting-proxy"
              value={settings['network.proxy']}
              onCommit={(v) => set({ 'network.proxy': v })}
            />
            <p className="hint">{C.proxyHint}</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="setting-no-proxy">
              {C.noProxy}
            </label>
            <TextSetting
              key={noProxy}
              id="setting-no-proxy"
              value={noProxy === '' ? null : noProxy}
              onCommit={(v) => set({ 'network.noProxy': (v ?? '').split(/[,\s]+/).filter((host) => host !== '') })}
            />
            <p className="hint">{C.noProxyHint}</p>
          </div>
        </>
      )}
    </Panel>
  );
}
