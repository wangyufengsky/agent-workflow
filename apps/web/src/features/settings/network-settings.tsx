import type { Settings } from '@aw/shared';
import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { Panel } from '../../components/panel.tsx';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
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

/** Whom the backend trusts and which proxy it takes (D164, D165); pro mode. Inputs are keyed by the saved value. */
export function NetworkSettings({ settings, set }: { settings: Settings; set: (patch: Partial<Settings>) => void }) {
  const noProxy = settings['network.noProxy'].join(',');
  return (
    <Panel title={C.network}>
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
    </Panel>
  );
}
