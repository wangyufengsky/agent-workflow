import { type Settings, themePreferenceSchema, UiMode } from '@aw/shared';
import { useState } from 'react';
import { Panel } from '../../components/panel.tsx';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { useSettings, useUpdateSettings } from './settings.queries.ts';

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="seg">
      <legend className="sr">{label}</legend>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

function ConcurrencyInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      id="concurrency"
      className="input narrow"
      type="number"
      min={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** Simple-mode settings (14 §3.7); pro-only keys (SETTING_MODE) come with M5-08. */
export function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const set = (patch: Partial<Settings>) => update.mutate(patch);
  const isPro = settings['ui.mode'] === UiMode.Pro;

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1 className="title grow">{C.title}</h1>
      </div>
      <div className="stack">
        <Panel title={C.appearance}>
          <div className="field">
            <span className="label">{C.theme}</span>
            <Segmented
              label={C.theme}
              value={settings['ui.theme']}
              options={themePreferenceSchema.options.map((t) => ({ value: t, label: THEME_LABEL[t] }))}
              onChange={(t) => set({ 'ui.theme': t })}
            />
            <p className="hint">{C.themeHint}</p>
          </div>
        </Panel>
        <Panel title={C.mode}>
          <div className="row">
            <div className="grow col">
              <span className="label" id="pro-mode-label">
                {C.proMode}
              </span>
              <span className="hint">{C.proModeHint}</span>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={isPro}
              aria-labelledby="pro-mode-label"
              onClick={() => set({ 'ui.mode': isPro ? UiMode.Simple : UiMode.Pro })}
            />
          </div>
        </Panel>
        <Panel title={C.ai}>
          <div className="field">
            <span className="label">{C.uncertainty}</span>
            <Segmented
              label={C.uncertainty}
              value={settings['ai.askOnUncertainty'] ? 'ask' : 'assume'}
              options={[
                { value: 'assume', label: C.assume },
                { value: 'ask', label: C.ask },
              ]}
              onChange={(v) => set({ 'ai.askOnUncertainty': v === 'ask' })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="concurrency">
              {C.concurrency}
            </label>
            <ConcurrencyInput
              key={settings['scheduler.maxConcurrentAttempts']}
              value={settings['scheduler.maxConcurrentAttempts']}
              onCommit={(n) => set({ 'scheduler.maxConcurrentAttempts': n })}
            />
            <p className="hint">{C.concurrencyHint}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
